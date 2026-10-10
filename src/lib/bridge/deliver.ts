import { ErpError, type ErpClient } from "@/lib/erp/client";
import type { Sql } from "@/lib/postgres";
import type { ShopifyOrder } from "@/lib/shopify/order";
import { toErpLines } from "./mapping";

// Every store order lands in the ERP under one customer account; no person's data crosses.
export const CUSTOMER_ACCOUNT = "WEB-STORE";

export const externalRef = (shopifyOrderId: number | string) => `shopify-${shopifyOrderId}`;

export type Delivery =
  | { outcome: "created" | "found_in_erp"; erpRef: string }
  | { outcome: "failed"; error: string; httpStatus: number | null }
  | { outcome: "skipped" };

// One try at writing an order into the ERP.
//
// The order is claimed first (status → delivering), so two deliveries of the same order never
// run at the same time. From the second try on, the ERP is asked whether it already has the
// order: an earlier try may have created it and lost the answer, and the ERP itself will not
// refuse a duplicate.
export async function deliverOrder(sql: Sql, erp: ErpClient, orderId: number): Promise<Delivery> {
  const [claim] = await sql<{ attempts: number; payload: ShopifyOrder }[]>`
    UPDATE bridge.orders SET status = 'delivering', attempts = attempts + 1
    WHERE id = ${orderId} AND status IN ('received', 'failed')
    RETURNING attempts, payload`;
  if (!claim) return { outcome: "skipped" };

  const number = claim.attempts;
  const order = claim.payload;
  const startedAt = new Date();
  let result: Delivery;
  try {
    const rows = await sql<{ shopify_sku: string; erp_code: string }[]>`SELECT shopify_sku, erp_code FROM bridge.sku_map`;
    const lines = toErpLines(order.line_items, new Map(rows.map((r) => [r.shopify_sku, r.erp_code])));
    const ref = externalRef(order.id);
    const existing = number > 1 ? await erp.findOrders(ref) : [];
    if (existing.length > 0) {
      result = { outcome: "found_in_erp", erpRef: existing[0].ref };
    } else {
      const created = await erp.createOrder({ external_ref: ref, customer_account: CUSTOMER_ACCOUNT, lines });
      result = { outcome: "created", erpRef: created.ref };
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    result = { outcome: "failed", error: message, httpStatus: cause instanceof ErpError ? cause.status : null };
  }

  const durationMs = Date.now() - startedAt.getTime();
  await sql.begin(async (tx) => {
    await tx`INSERT INTO bridge.attempts (order_id, number, started_at, duration_ms, outcome, http_status, error)
      VALUES (${orderId}, ${number}, ${startedAt}, ${durationMs}, ${result.outcome},
              ${result.outcome === "failed" ? result.httpStatus : null},
              ${result.outcome === "failed" ? result.error : null})`;
    if (result.outcome === "failed") {
      await tx`UPDATE bridge.orders SET status = 'failed', last_error = ${result.error} WHERE id = ${orderId}`;
    } else {
      await tx`UPDATE bridge.orders SET status = 'delivered', erp_ref = ${result.erpRef}, last_error = NULL,
        delivered_at = now() WHERE id = ${orderId}`;
    }
  });
  return result;
}
