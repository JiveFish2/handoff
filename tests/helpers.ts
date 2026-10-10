import { erpClient } from "@/lib/erp/client";
import { erpServer, type FaultMode } from "@/lib/erp/server";
import { connect } from "@/lib/postgres";
import { seed } from "@/lib/seed";
import type { Queue } from "@/lib/queue";
import type { ShopifyOrder } from "@/lib/shopify/order";

export const sql = connect(process.env.TEST_DATABASE_URL!, 3);

const API_KEY = "test-key";

// The ERP client wired straight to the ERP's handlers: real HTTP semantics (status codes,
// headers, JSON bodies, the client's timeout), no server to start. As over a real network, a
// request the client gave up on still runs to the end on the ERP's side.
export function erpForTests(options: { slowMs?: number; timeoutMs?: number } = {}) {
  const server = erpServer(sql, { apiKey: API_KEY, slowMs: options.slowMs });
  const fetchToServer: typeof fetch = async (input, init) => {
    const request = new Request(input as string, { ...init, signal: undefined });
    const handled = request.method === "POST" ? server.createOrder(request) : server.findOrders(request);
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
  await sql`TRUNCATE bridge.replays, bridge.attempts, bridge.webhooks, bridge.orders, bridge.sku_map,
    erp.order_lines, erp.orders, erp.items, erp.faults`;
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
export function fakeQueue(): Queue & { queued: number[] } {
  const queued: number[] = [];
  return { queued, enqueueDelivery: async (orderId) => void queued.push(orderId) };
}
