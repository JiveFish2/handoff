import type { ErpClient } from "@/lib/erp/client";
import type { Sql } from "@/lib/postgres";
import type { Queue } from "@/lib/queue";
import type { Store } from "@/lib/shopify/store";
import { enqueue } from "./enqueue";
import { receiveOrder } from "./receive";
import { reconcileStock } from "./stock";

// The nightly check that does not trust anything that happened during the day.
// 1. Orders: every store order of the last two days must be known to the bridge. Webhooks can
//    be lost (an outage on either side, a subscription removed); a missing order is taken in
//    exactly as if its webhook had arrived, and queued.
// 2. Stock: every variant's store quantity must match the ERP's, minus what is still on its
//    way there. Differences are corrected.
// The result is kept, so the console can show what the last run found.
export async function reconcile(sql: Sql, erp: ErpClient, store: Store, queue: Queue, now = new Date()) {
  const [run] = await sql<{ id: number }[]>`INSERT INTO bridge.reconciliations DEFAULT VALUES RETURNING id`;
  try {
    const recent = await store.ordersSince(new Date(now.getTime() - 48 * 3600_000));
    const known = new Set(
      (await sql<{ shopify_order_id: string }[]>`
        SELECT shopify_order_id FROM bridge.orders WHERE shopify_order_id = ANY(${recent.map((o) => o.id)})`)
        .map((r) => Number(r.shopify_order_id)),
    );
    const missing = recent.filter((o) => !known.has(o.id));
    for (const order of missing) {
      const received = await receiveOrder(sql, {
        webhookId: `reconcile:${order.id}`, eventId: null, topic: "orders/create", shopDomain: null, order,
      });
      if (received.kind === "new") await enqueue(sql, queue, received.orderId);
    }

    const stock = await reconcileStock(sql, erp, store);
    const details = { missingOrders: missing.map((o) => o.name), stockFixes: stock.fixes };
    await sql`UPDATE bridge.reconciliations SET finished_at = now(), orders_checked = ${recent.length},
      orders_missing = ${missing.length}, stock_checked = ${stock.checked}, stock_fixed = ${stock.fixes.length},
      details = ${sql.json(details)} WHERE id = ${run.id}`;
    return { ordersChecked: recent.length, ...details };
  } catch (error) {
    await sql`UPDATE bridge.reconciliations SET finished_at = now(), error = ${String(error)} WHERE id = ${run.id}`;
    throw error;
  }
}
