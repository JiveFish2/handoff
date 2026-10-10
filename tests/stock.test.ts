import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { START_STOCK } from "@/catalog";
import { deliverOrder } from "@/lib/bridge/deliver";
import { runDeliveryJob } from "@/lib/bridge/job";
import { receiveOrder } from "@/lib/bridge/receive";
import { reconcile } from "@/lib/bridge/reconcile";
import { syncStock } from "@/lib/bridge/stock";
import type { ShopifyOrder } from "@/lib/shopify/order";
import { erpForTests, fakeQueue, fakeStore, fault, reset, sampleOrder, sql } from "./helpers";

let webhooks = 0;
async function store(order: ShopifyOrder = sampleOrder()) {
  const received = await receiveOrder(sql, {
    webhookId: `s-${webhooks++}`, eventId: null, topic: "orders/create", shopDomain: null, order,
  });
  return received.orderId!;
}

beforeEach(reset);
afterAll(() => sql.end());

describe("syncStock", () => {
  it("pushes every item on the first run, then only what changed", async () => {
    const shop = fakeStore();
    const first = await syncStock(sql, erpForTests(), shop);
    expect(first).toHaveLength(12);
    expect(shop.available("first-light-250")).toBe(START_STOCK["250"]);
    expect(shop.available("first-light-1kg")).toBe(START_STOCK["1000"]);

    expect(await syncStock(sql, erpForTests(), shop)).toEqual([]);

    await erpForTests().adjustStock({ item_code: "KH-ETH-250", delta: 20, reason: "Roastery delivery" });
    expect(await syncStock(sql, erpForTests(), shop)).toEqual([{ sku: "first-light-250", quantity: 60 }]);
    expect(shop.available("first-light-250")).toBe(60);
  });

  it("holds back units the store sold that the ERP has not booked yet", async () => {
    const shop = fakeStore();
    await syncStock(sql, erpForTests(), shop);

    // Sold in the store, stuck in the failed queue: not in the ERP's number.
    const id = await store(sampleOrder([{ sku: "long-table-250", quantity: 3 }]));
    await fault("rejects");
    await deliverOrder(sql, erpForTests(), id);
    await fault(null);

    await erpForTests().adjustStock({ item_code: "KH-COL-250", delta: 10, reason: "Count" });
    await syncStock(sql, erpForTests(), shop);
    expect(shop.available("long-table-250")).toBe(START_STOCK["250"] + 10 - 3);
  });

  it("does not move the cursor when the store refuses the update", async () => {
    const shop = fakeStore();
    await syncStock(sql, erpForTests(), shop);
    await erpForTests().adjustStock({ item_code: "KH-KEN-250", delta: -5, reason: "Damaged bags" });

    const failing = { ...shop, setAvailable: async () => { throw new Error("Shopify unavailable"); } };
    await expect(syncStock(sql, erpForTests(), failing)).rejects.toThrow("Shopify unavailable");
    expect(await syncStock(sql, erpForTests(), shop)).toEqual([{ sku: "high-ground-250", quantity: START_STOCK["250"] - 5 }]);
  });

  it("is triggered by every order delivered", async () => {
    const queue = fakeQueue();
    await runDeliveryJob(sql, erpForTests(), queue, { orderId: await store(), retried: 0 });
    expect(queue.stockSyncs).toBe(1);
  });

  it("delivers an order and leaves the store at the ERP's new number", async () => {
    const shop = fakeStore();
    await syncStock(sql, erpForTests(), shop);
    const id = await store(sampleOrder([{ sku: "night-shift-1kg", quantity: 2 }]));
    await deliverOrder(sql, erpForTests(), id);
    await syncStock(sql, erpForTests(), shop);
    expect(shop.available("night-shift-1kg")).toBe(START_STOCK["1000"] - 2);
  });
});

describe("reconcile", () => {
  it("takes in a store order whose webhook never arrived", async () => {
    const shop = fakeStore();
    const lost = sampleOrder([{ sku: "slow-sunday-250" }]);
    const seen = sampleOrder();
    await store(seen);
    shop.orders.push(lost, seen);

    const queue = fakeQueue();
    const result = await reconcile(sql, erpForTests(), shop, queue);

    expect(result.missingOrders).toEqual([lost.name]);
    const [row] = await sql<{ id: number }[]>`SELECT id FROM bridge.orders WHERE shopify_order_id = ${lost.id}`;
    expect(queue.queued).toEqual([row.id]);
    expect(await sql`SELECT webhook_id FROM bridge.webhooks WHERE order_id = ${row.id}`).toEqual([{ webhook_id: `reconcile:${lost.id}` }]);
  });

  it("corrects store quantities that drifted from the ERP, and only those", async () => {
    const shop = fakeStore();
    await syncStock(sql, erpForTests(), shop);
    // Someone edited stock by hand in the store admin.
    await shop.setAvailable([{ inventoryItemId: "item-0", quantity: 3 }], "manual edit");

    const result = await reconcile(sql, erpForTests(), shop, fakeQueue());

    expect(result.stockFixes).toEqual([{ sku: "first-light-250", store: 3, expected: START_STOCK["250"] }]);
    expect(shop.available("first-light-250")).toBe(START_STOCK["250"]);
    expect(await sql`SELECT stock_checked, stock_fixed, orders_missing, error FROM bridge.reconciliations`).toEqual([
      { stock_checked: 12, stock_fixed: 1, orders_missing: 0, error: null },
    ]);
  });

  it("records a run that failed", async () => {
    const shop = { ...fakeStore(), ordersSince: async () => { throw new Error("Shopify unavailable"); } };
    await expect(reconcile(sql, erpForTests(), shop, fakeQueue())).rejects.toThrow();
    const [run] = await sql`SELECT error, finished_at FROM bridge.reconciliations`;
    expect(run.error).toContain("Shopify unavailable");
    expect(run.finished_at).not.toBeNull();
  });
});
