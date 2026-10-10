import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER_ACCOUNT, deliverOrder, externalRef } from "@/lib/bridge/deliver";
import { receiveOrder } from "@/lib/bridge/receive";
import type { ShopifyOrder } from "@/lib/shopify/order";
import { erpForTests, fault, reset, sampleOrder, sql } from "./helpers";

let webhooks = 0;
async function store(order: ShopifyOrder) {
  const received = await receiveOrder(sql, {
    webhookId: `w-${webhooks++}`, eventId: null, topic: "orders/create", shopDomain: null, order,
  });
  return received.orderId!;
}

const erpOrders = (order: ShopifyOrder) =>
  sql`SELECT ref, customer_account FROM erp.orders WHERE external_ref = ${externalRef(order.id)}`;

beforeEach(reset);
afterAll(() => sql.end());

describe("deliverOrder", () => {
  it("writes the order into the ERP with ERP codes and books the stock", async () => {
    const order = sampleOrder([{ sku: "first-light-250", quantity: 2, grind: "Filter" }, { sku: "night-shift-1kg" }]);
    const id = await store(order);

    const result = await deliverOrder(sql, erpForTests(), id);

    expect(result.outcome).toBe("created");
    const [erp] = await erpOrders(order);
    expect(erp.customer_account).toBe(CUSTOMER_ACCOUNT);
    expect(await sql`SELECT item_code, quantity, note FROM erp.order_lines WHERE order_ref = ${erp.ref} ORDER BY line`).toEqual([
      { item_code: "KH-ETH-250", quantity: 2, note: "Grind: Filter" },
      { item_code: "KH-GUA-1000", quantity: 1, note: null },
    ]);
    expect(await sql`SELECT stock FROM erp.items WHERE code = 'KH-ETH-250'`).toEqual([{ stock: 38 }]);
    expect(await sql`SELECT status, erp_ref FROM bridge.orders WHERE id = ${id}`).toEqual([{ status: "delivered", erp_ref: erp.ref }]);
  });

  it("does not deliver an order that is already delivered", async () => {
    const id = await store(sampleOrder());
    await deliverOrder(sql, erpForTests(), id);
    expect(await deliverOrder(sql, erpForTests(), id)).toEqual({ outcome: "skipped" });
    expect(await sql`SELECT count(*)::int AS n FROM erp.orders`).toEqual([{ n: 1 }]);
  });

  it("records a failure when the ERP is down, then delivers on the next try", async () => {
    const order = sampleOrder();
    const id = await store(order);

    await fault("down");
    expect(await deliverOrder(sql, erpForTests(), id)).toMatchObject({ outcome: "failed", httpStatus: 503 });
    expect(await sql`SELECT status, attempts FROM bridge.orders WHERE id = ${id}`).toEqual([{ status: "retrying", attempts: 1 }]);

    await fault(null);
    expect(await deliverOrder(sql, erpForTests(), id)).toMatchObject({ outcome: "created" });
    expect(await erpOrders(order)).toHaveLength(1);
  });

  it("finds the order instead of creating it twice when the ERP's answer was lost", async () => {
    const order = sampleOrder();
    const id = await store(order);

    await fault("response_lost");
    expect(await deliverOrder(sql, erpForTests(), id)).toMatchObject({ outcome: "failed", httpStatus: 504 });
    expect(await erpOrders(order)).toHaveLength(1); // the ERP did create it

    await fault(null);
    const retry = await deliverOrder(sql, erpForTests(), id);
    expect(retry.outcome).toBe("found_in_erp");
    expect(await erpOrders(order)).toHaveLength(1);
  });

  it("gives up on a slow ERP, and finds the order it created anyway on the next try", async () => {
    const order = sampleOrder();
    const id = await store(order);
    await fault("slow");
    const result = await deliverOrder(sql, erpForTests({ slowMs: 300, timeoutMs: 100 }), id);
    expect(result).toMatchObject({ outcome: "failed", httpStatus: null });

    await new Promise((resolve) => setTimeout(resolve, 400)); // the ERP finishes on its own
    await fault(null);
    expect((await deliverOrder(sql, erpForTests(), id)).outcome).toBe("found_in_erp");
    expect(await erpOrders(order)).toHaveLength(1);
  });

  it("keeps the ERP's Retry-After when it is rate limited", async () => {
    const id = await store(sampleOrder());
    await fault("rate_limited");
    expect(await deliverOrder(sql, erpForTests(), id)).toMatchObject({
      outcome: "failed", httpStatus: 429, kind: "transient", retryAfterSeconds: 5, final: false,
    });
  });

  it("sends an unmapped SKU straight to the failed queue without calling the ERP", async () => {
    const id = await store(sampleOrder([{ sku: "gift-card-25" }]));
    expect(await deliverOrder(sql, erpForTests(), id)).toMatchObject({ outcome: "failed", kind: "permanent", final: true });
    expect(await sql`SELECT status FROM bridge.orders WHERE id = ${id}`).toEqual([{ status: "failed" }]);
    expect(await sql`SELECT count(*)::int AS n FROM erp.orders`).toEqual([{ n: 0 }]);
  });

  it("sends an order the ERP rejects to the failed queue", async () => {
    const id = await store(sampleOrder());
    await fault("rejects");
    expect(await deliverOrder(sql, erpForTests(), id)).toMatchObject({ httpStatus: 422, kind: "permanent", final: true });
    expect(await sql`SELECT status FROM bridge.orders WHERE id = ${id}`).toEqual([{ status: "failed" }]);
  });

  it("gives up after the last try even on a transient error", async () => {
    const id = await store(sampleOrder());
    await fault("down");
    expect(await deliverOrder(sql, erpForTests(), id, { lastTry: true })).toMatchObject({ kind: "transient", final: true });
    expect(await sql`SELECT status FROM bridge.orders WHERE id = ${id}`).toEqual([{ status: "failed" }]);
  });

  it("takes over a try that died half-way, but not one still running", async () => {
    const id = await store(sampleOrder());
    await sql`UPDATE bridge.orders SET status = 'delivering', claimed_at = now() WHERE id = ${id}`;
    expect(await deliverOrder(sql, erpForTests(), id)).toEqual({ outcome: "skipped" });
    await sql`UPDATE bridge.orders SET claimed_at = now() - interval '2 minutes' WHERE id = ${id}`;
    expect((await deliverOrder(sql, erpForTests(), id)).outcome).toBe("created");
  });

  it("lets only one of two simultaneous deliveries run", async () => {
    const id = await store(sampleOrder());
    const results = await Promise.all([deliverOrder(sql, erpForTests(), id), deliverOrder(sql, erpForTests(), id)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["created", "skipped"]);
    expect(await sql`SELECT count(*)::int AS n FROM erp.orders`).toEqual([{ n: 1 }]);
  });
});
