import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runDeliveryJob } from "@/lib/bridge/job";
import { receiveOrder } from "@/lib/bridge/receive";
import { replayOrder } from "@/lib/bridge/replay";
import { sweep } from "@/lib/bridge/sweep";
import { MAX_RETRIES } from "@/lib/queue";
import type { ShopifyOrder } from "@/lib/shopify/order";
import { erpForTests, fakeQueue, fault, reset, sampleOrder, sql } from "./helpers";

let webhooks = 0;
async function store(order: ShopifyOrder = sampleOrder()) {
  const received = await receiveOrder(sql, {
    webhookId: `q-${webhooks++}`, eventId: null, topic: "orders/create", shopDomain: null, order,
  });
  return received.orderId!;
}

beforeEach(reset);
afterAll(() => sql.end());

describe("runDeliveryJob", () => {
  it("answers 200 when the order is delivered", async () => {
    const id = await store();
    expect((await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: 0 })).status).toBe(200);
  });

  it("asks the queue to try again while the ERP is down, then delivers", async () => {
    const id = await store();
    await fault("down");
    expect((await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: 0 })).status).toBe(503);
    expect((await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: 1 })).status).toBe(503);
    await fault(null);
    expect((await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: 2 })).status).toBe(200);
    expect(await sql`SELECT status, attempts FROM bridge.orders WHERE id = ${id}`).toEqual([{ status: "delivered", attempts: 3 }]);
  });

  it("passes the ERP's Retry-After on to the queue", async () => {
    const id = await store();
    await fault("rate_limited");
    const job = await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: 0 });
    expect(job).toMatchObject({ status: 503, headers: { "Retry-After": "5" } });
  });

  it("stops the queue's retries once the order is in the failed queue", async () => {
    const id = await store();
    await fault("down");
    const job = await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: MAX_RETRIES });
    expect(job.status).toBe(200);
    expect(await sql`SELECT status FROM bridge.orders WHERE id = ${id}`).toEqual([{ status: "failed" }]);
  });

  it("does not retry a permanent failure", async () => {
    const id = await store(sampleOrder([{ sku: "gift-card-25" }]));
    expect((await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: 0 })).status).toBe(200);
  });
});

describe("replayOrder", () => {
  it("sends a failed order back to the queue once its cause is fixed", async () => {
    const id = await store(sampleOrder([{ sku: "gift-card-25" }]));
    await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: 0 });
    await sql`INSERT INTO bridge.sku_map VALUES ('gift-card-25', 'KH-HSE-250')`;

    const queue = fakeQueue();
    expect(await replayOrder(sql, queue, id)).toBe(true);
    expect(queue.queued).toEqual([id]);
    expect((await runDeliveryJob(sql, erpForTests(), { orderId: id, retried: 0 })).body.outcome).toBe("created");
    expect(await sql`SELECT count(*)::int AS n FROM bridge.replays WHERE order_id = ${id}`).toEqual([{ n: 1 }]);
  });

  it("refuses to replay an order that is not failed", async () => {
    const id = await store();
    const queue = fakeQueue();
    expect(await replayOrder(sql, queue, id)).toBe(false);
    expect(queue.queued).toEqual([]);
  });
});

describe("sweep", () => {
  it("queues orders the queue lost, once, and leaves recent and finished ones alone", async () => {
    const neverQueued = await store();
    const stuck = await store();
    const lostRetry = await store();
    const fresh = await store();
    const delivered = await store();
    await sql`UPDATE bridge.orders SET received_at = now() - interval '1 hour'`;
    await sql`UPDATE bridge.orders SET received_at = now() WHERE id = ${fresh}`;
    await sql`UPDATE bridge.orders SET status = 'delivering', claimed_at = now() - interval '10 minutes' WHERE id = ${stuck}`;
    await sql`UPDATE bridge.orders SET status = 'retrying', attempts = 1 WHERE id = ${lostRetry}`;
    await sql`INSERT INTO bridge.attempts (order_id, number, started_at, duration_ms, outcome, error_kind)
      VALUES (${lostRetry}, 1, now() - interval '1 hour', 10, 'failed', 'transient')`;
    await sql`UPDATE bridge.orders SET status = 'delivered' WHERE id = ${delivered}`;

    const queue = fakeQueue();
    expect((await sweep(sql, queue)).sort()).toEqual([neverQueued, stuck, lostRetry].sort());
    // Just queued: the next sweep leaves them to the queue.
    expect(await sweep(sql, fakeQueue())).toEqual([]);
  });
});
