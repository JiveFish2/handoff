import type { ErpClient } from "@/lib/erp/client";
import type { Sql } from "@/lib/postgres";
import { MAX_RETRIES, type Queue } from "@/lib/queue";
import { deliverOrder, type Delivery } from "./deliver";

export type JobResponse = { status: number; headers?: Record<string, string>; body: Delivery };

// What the queue's callback answers. A 2xx tells QStash the message is done: delivered,
// already handled, or put in the failed queue by the bridge itself. A 503 asks for another
// try, carrying the ERP's Retry-After when it sent one, so a rate limit is respected.
// A delivered order changed the ERP's stock, so a stock sync follows.
export async function runDeliveryJob(
  sql: Sql,
  erp: ErpClient,
  queue: Queue,
  { orderId, retried }: { orderId: number; retried: number },
): Promise<JobResponse> {
  const result = await deliverOrder(sql, erp, orderId, { lastTry: retried >= MAX_RETRIES });
  if (result.outcome === "created") {
    // Not worth failing the delivery over: the scheduled sync catches up anyway.
    await queue.enqueueStockSync().catch((error) => console.error("Stock sync not queued", error));
  }
  if (result.outcome === "failed" && !result.final) {
    const headers = result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : undefined;
    return { status: 503, headers, body: result };
  }
  return { status: 200, body: result };
}
