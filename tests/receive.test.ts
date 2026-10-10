import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { receiveOrder } from "@/lib/bridge/receive";
import { reset, sampleOrder, sql } from "./helpers";

const webhook = (webhookId: string, order = sampleOrder()) => ({
  webhookId, eventId: null, topic: "orders/create", shopDomain: "kilnhouse-coffee.myshopify.com", order,
});

beforeEach(reset);
afterAll(() => sql.end());

describe("receiveOrder", () => {
  it("stores a new order once", async () => {
    const received = await receiveOrder(sql, webhook("w-1"));
    expect(received.kind).toBe("new");
    expect(await sql`SELECT status FROM bridge.orders`).toEqual([{ status: "received" }]);
  });

  it("acknowledges a redelivered webhook without storing anything", async () => {
    const first = await receiveOrder(sql, webhook("w-1"));
    const again = await receiveOrder(sql, webhook("w-1"));
    expect(again).toEqual({ kind: "duplicate_webhook", orderId: first.orderId });
    expect(await sql`SELECT count(*)::int AS n FROM bridge.orders`).toEqual([{ n: 1 }]);
  });

  it("keeps one order when two different webhooks describe it", async () => {
    const order = sampleOrder();
    const first = await receiveOrder(sql, webhook("w-1", order));
    const second = await receiveOrder(sql, webhook("w-2", order));
    expect(second).toEqual({ kind: "duplicate_order", orderId: first.orderId });
    expect(await sql`SELECT count(*)::int AS n FROM bridge.webhooks WHERE order_id = ${first.orderId}`).toEqual([{ n: 2 }]);
  });

  it("stores one order when the same webhook arrives twice at the same moment", async () => {
    const order = sampleOrder();
    const results = await Promise.all([receiveOrder(sql, webhook("w-1", order)), receiveOrder(sql, webhook("w-1", order))]);
    expect(results.map((r) => r.kind).sort()).toEqual(["duplicate_webhook", "new"]);
    expect(await sql`SELECT count(*)::int AS n FROM bridge.orders`).toEqual([{ n: 1 }]);
  });
});
