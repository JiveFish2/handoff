import { erpClient } from "@/lib/erp/client";
import { erpServer, type FaultMode } from "@/lib/erp/server";
import { connect } from "@/lib/postgres";
import { seed } from "@/lib/seed";
import type { Queue } from "@/lib/queue";
import type { ShopifyOrder } from "@/lib/shopify/order";
import type { Store } from "@/lib/shopify/store";
import { variants } from "@/catalog";

export const sql = connect(process.env.TEST_DATABASE_URL!, 3);

const API_KEY = "test-key";

// The ERP client wired straight to the ERP's handlers: real HTTP semantics (status codes,
// headers, JSON bodies, the client's timeout), no server to start. As over a real network, a
// request the client gave up on still runs to the end on the ERP's side.
export function erpForTests(options: { slowMs?: number; timeoutMs?: number } = {}) {
  const server = erpServer(sql, { apiKey: API_KEY, slowMs: options.slowMs });
  const fetchToServer: typeof fetch = async (input, init) => {
    const request = new Request(input as string, { ...init, signal: undefined });
    const path = new URL(request.url).pathname;
    const handled =
      path.endsWith("/stock/adjustments") ? server.adjustStock(request)
      : path.endsWith("/stock") ? server.getStock(request)
      : request.method === "POST" ? server.createOrder(request)
      : server.findOrders(request);
    const signal = init?.signal;
    if (!signal) return handled;
    return new Promise<Response>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      handled.then(resolve, reject);
    });
  };
  return erpClient({ baseUrl: "http://erp.test/erp/api", apiKey: API_KEY, timeoutMs: options.timeoutMs, fetch: fetchToServer });
}

export async function reset() {
  await sql`TRUNCATE bridge.reconciliations, bridge.stock_pushes, bridge.state, bridge.replays, bridge.attempts, bridge.webhooks, bridge.orders, bridge.sku_map,
    erp.stock_adjustments, erp.order_lines, erp.orders, erp.items, erp.faults`;
  await seed(sql);
}

export async function fault(mode: FaultMode | null) {
  await sql`DELETE FROM erp.faults`;
  if (mode) await sql`INSERT INTO erp.faults (mode, until) VALUES (${mode}, now() + interval '5 minutes')`;
}

let nextId = 5_000_000;
export function sampleOrder(lines: { sku: string | null; quantity?: number; grind?: string }[] = [{ sku: "first-light-250" }]): ShopifyOrder {
  const id = nextId++;
  return {
    id,
    name: `#${id % 10_000}`,
    currency: "USD",
    total_price: "0.00",
    created_at: new Date().toISOString(),
    line_items: lines.map((l, i) => ({
      id: id * 10 + i,
      sku: l.sku,
      title: l.sku ?? "No SKU",
      quantity: l.quantity ?? 1,
      price: "19.00",
      properties: l.grind ? [{ name: "Grind", value: l.grind }] : [],
    })),
  };
}

// A queue that only remembers what it was given.
export function fakeQueue(): Queue & { queued: number[]; stockSyncs: number } {
  const queue = {
    queued: [] as number[],
    stockSyncs: 0,
    enqueueDelivery: async (orderId: number) => void queue.queued.push(orderId),
    enqueueStockSync: async () => void queue.stockSyncs++,
  };
  return queue;
}

// The store in memory: every catalog variant with a stock level, and a list of orders.
export function fakeStore(start: Record<string, number> = {}) {
  const levels = new Map(variants().map((v, i) => [v.shopifySku, { inventoryItemId: `item-${i}`, available: start[v.shopifySku] ?? 0 }]));
  type FakeStore = Store & { orders: ShopifyOrder[]; sets: number; available(sku: string): number };
  const store: FakeStore = {
    orders: [],
    sets: 0,
    available: (sku: string) => levels.get(sku)!.available,
    levels: async () => [...levels].map(([sku, l]) => ({ sku, ...l })),
    setAvailable: async (items) => {
      if (items.length) store.sets++;
      for (const item of items) {
        for (const level of levels.values()) if (level.inventoryItemId === item.inventoryItemId) level.available = item.quantity;
      }
    },
    ordersSince: async () => store.orders,
  };
  return store;
}
