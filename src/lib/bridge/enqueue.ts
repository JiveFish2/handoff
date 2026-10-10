import type { Sql } from "@/lib/postgres";
import type { Queue } from "@/lib/queue";

// Hands an order to the queue and notes when, so the sweep can tell a fresh order from one
// that never made it into the queue.
export async function enqueue(sql: Sql, queue: Queue, orderId: number) {
  await queue.enqueueDelivery(orderId);
  await sql`UPDATE bridge.orders SET queued_at = now() WHERE id = ${orderId}`;
}
