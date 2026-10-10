import { variants } from "@/catalog";
import type { Sql } from "@/lib/postgres";
import type { ShopifyOrder } from "@/lib/shopify/order";
import type { Attempt } from "./describe";

// Everything the console shows, read in one go. "Today" is the last 24 hours.

const TITLES = new Map(variants().map((v) => [v.shopifySku, v.title.replace(" · ", " ")]));
export const itemsLine = (order: ShopifyOrder) =>
  order.line_items.map((l) => `${l.quantity}× ${(l.sku && TITLES.get(l.sku)) ?? l.title}`).join(", ");

export type ConsoleOrder = {
  id: number;
  name: string;
  status: "received" | "delivering" | "retrying" | "delivered" | "failed";
  erpRef: string | null;
  receivedAt: Date;
  attempts: number;
  items: string;
  total: string;
  viaReconcile: boolean;
  replays: number;
};

export async function consoleData(sql: Sql) {
  const [orders, stats, faults, reconciliation] = await Promise.all([
    sql<{ id: string; name: string; status: ConsoleOrder["status"]; erp_ref: string | null; received_at: Date; attempts: number;
      payload: ShopifyOrder; via_reconcile: boolean; replays: number }[]>`
      SELECT o.id, o.name, o.status, o.erp_ref, o.received_at, o.attempts, o.payload,
        EXISTS (SELECT 1 FROM bridge.webhooks w WHERE w.order_id = o.id AND w.webhook_id LIKE 'reconcile:%') AS via_reconcile,
        (SELECT count(*)::int FROM bridge.replays r WHERE r.order_id = o.id) AS replays
      FROM bridge.orders o ORDER BY o.received_at DESC LIMIT 25`,
    sql<{ orders: number; in_erp: number; first_try: number; retries: number; failed: number; replays: number; duplicates: number }[]>`
      SELECT
        count(*)::int AS orders,
        count(*) FILTER (WHERE status = 'delivered')::int AS in_erp,
        count(*) FILTER (WHERE status = 'delivered' AND attempts = 1)::int AS first_try,
        (SELECT count(*)::int FROM bridge.attempts a JOIN bridge.orders x ON x.id = a.order_id
           WHERE a.number > 1 AND x.received_at > now() - interval '1 day')
          - (SELECT count(*)::int FROM bridge.replays WHERE replayed_at > now() - interval '1 day') AS retries,
        (SELECT count(*)::int FROM bridge.orders WHERE status = 'failed') AS failed,
        (SELECT count(*)::int FROM bridge.replays WHERE replayed_at > now() - interval '1 day') AS replays,
        (SELECT count(*)::int FROM (SELECT external_ref FROM erp.orders GROUP BY external_ref HAVING count(*) > 1) d) AS duplicates
      FROM bridge.orders WHERE received_at > now() - interval '1 day'`,
    sql<{ mode: string; until: Date }[]>`SELECT mode, until FROM erp.faults WHERE until > now()`,
    sql<{ finished_at: Date | null; orders_checked: number | null; orders_missing: number | null; stock_checked: number | null;
      stock_fixed: number | null; details: { missingOrders?: string[] } | null; error: string | null }[]>`
      SELECT finished_at, orders_checked, orders_missing, stock_checked, stock_fixed, details, error
      FROM bridge.reconciliations ORDER BY id DESC LIMIT 1`,
  ]);
  return {
    orders: orders.map<ConsoleOrder>((o) => ({
      id: Number(o.id), name: o.name, status: o.status, erpRef: o.erp_ref, receivedAt: o.received_at, attempts: o.attempts,
      items: itemsLine(o.payload), total: Number(o.payload.total_price).toFixed(2), viaReconcile: o.via_reconcile, replays: o.replays,
    })),
    stats: stats[0],
    faults: new Map(faults.map((f) => [f.mode, f.until])),
    reconciliation: reconciliation[0] ?? null,
  };
}

export type TrailEvent =
  | { kind: "received"; at: Date; viaReconcile: boolean }
  | { kind: "attempt"; at: Date; attempt: Attempt; retried: number }
  | { kind: "replay"; at: Date };

// One order's story: when it arrived, each try, each replay, in time order. Each try knows how
// many retries preceded it since the order last entered the queue, to explain the waits.
export async function orderTrail(sql: Sql, orderId: number): Promise<TrailEvent[]> {
  const [webhooks, attempts, replays] = await Promise.all([
    sql<{ received_at: Date; webhook_id: string }[]>`
      SELECT received_at, webhook_id FROM bridge.webhooks WHERE order_id = ${orderId} ORDER BY received_at LIMIT 1`,
    sql<(Attempt & { started_at: Date })[]>`
      SELECT number, outcome, http_status, error, error_kind, duration_ms, started_at FROM bridge.attempts
      WHERE order_id = ${orderId} ORDER BY number`,
    sql<{ replayed_at: Date }[]>`SELECT replayed_at FROM bridge.replays WHERE order_id = ${orderId} ORDER BY replayed_at`,
  ]);
  const events: TrailEvent[] = [];
  if (webhooks[0]) events.push({ kind: "received", at: webhooks[0].received_at, viaReconcile: webhooks[0].webhook_id.startsWith("reconcile:") });
  for (const r of replays) events.push({ kind: "replay", at: r.replayed_at });
  for (const a of attempts) events.push({ kind: "attempt", at: a.started_at, attempt: a, retried: 0 });
  events.sort((x, y) => x.at.getTime() - y.at.getTime());
  let retried = -1;
  for (const e of events) {
    if (e.kind === "replay" || e.kind === "received") retried = -1;
    if (e.kind === "attempt") e.retried = ++retried;
  }
  return events;
}
