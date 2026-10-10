import { ErpError, type ErpClient } from "@/lib/erp/client";
import type { Sql } from "@/lib/postgres";
import type { ShopifyOrder } from "@/lib/shopify/order";
import { classify, type ErrorKind } from "./classify";
import { toErpLines } from "./mapping";

// Every store order lands in the ERP under one customer account; no person's data crosses.
export const CUSTOMER_ACCOUNT = "WEB-STORE";

export const externalRef = (shopifyOrderId: number | string) => `shopify-${shopifyOrderId}`;

export type Delivery =
  | { outcome: "created" | "found_in_erp"; erpRef: string }
  | {
      outcome: "failed";
      error: string;
      httpStatus: number | null;
      kind: ErrorKind;
      retryAfterSeconds: number | null;
      // True when the order went to the failed queue: no more automatic tries.
      final: boolean;
    }
  | { outcome: "skipped" };

// One try at writing an order into the ERP.
//
// The order is claimed first (status → delivering), so two deliveries of the same order never
// run at the same time; a claim older than a minute belongs to a try that died half-way and
// may be taken over. Before creating, the ERP is asked whether it already has the order: an
// earlier try may have created it and lost the answer, and the ERP itself will not refuse a
// duplicate. One read per order buys a delivery that is safe whatever happened before it.
//
// A failure leaves the order in `retrying`, unless it is permanent or this was the last try
// the queue will make, in which case it goes to `failed`, the failed queue.
export async function deliverOrder(
  sql: Sql,
  erp: ErpClient,
  orderId: number,
  { lastTry = false }: { lastTry?: boolean } = {},
): Promise<Delivery> {
  const [claim] = await sql<{ attempts: number; payload: ShopifyOrder }[]>`
    UPDATE bridge.orders SET status = 'delivering', attempts = attempts + 1, claimed_at = now()
    WHERE id = ${orderId}
      AND (status IN ('received', 'retrying')
           OR (status = 'delivering' AND claimed_at < now() - interval '1 minute'))
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
    const existing = await erp.findOrders(ref);
    if (existing.length > 0) {
      result = { outcome: "found_in_erp", erpRef: existing[0].ref };
    } else {
      const created = await erp.createOrder({ external_ref: ref, customer_account: CUSTOMER_ACCOUNT, lines });
      result = { outcome: "created", erpRef: created.ref };
    }
  } catch (cause) {
    const kind = classify(cause);
    result = {
      outcome: "failed",
      error: cause instanceof Error ? cause.message : String(cause),
      httpStatus: cause instanceof ErpError ? cause.status : null,
      kind,
      retryAfterSeconds: cause instanceof ErpError ? cause.retryAfterSeconds : null,
      final: kind === "permanent" || lastTry,
    };
  }

  const durationMs = Date.now() - startedAt.getTime();
  const failed = result.outcome === "failed" ? result : null;
  await sql.begin(async (tx) => {
    await tx`INSERT INTO bridge.attempts (order_id, number, started_at, duration_ms, outcome, http_status, error, error_kind)
      VALUES (${orderId}, ${number}, ${startedAt}, ${durationMs}, ${result.outcome},
              ${failed?.httpStatus ?? null}, ${failed?.error ?? null}, ${failed?.kind ?? null})`;
    if (failed) {
      await tx`UPDATE bridge.orders SET status = ${failed.final ? "failed" : "retrying"}, last_error = ${failed.error},
        claimed_at = NULL WHERE id = ${orderId}`;
    } else if (result.outcome === "created" || result.outcome === "found_in_erp") {
      await tx`UPDATE bridge.orders SET status = 'delivered', erp_ref = ${result.erpRef}, last_error = NULL,
        claimed_at = NULL, delivered_at = now() WHERE id = ${orderId}`;
    }
  });
  return result;
}
