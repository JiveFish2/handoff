import type { Sql } from "@/lib/postgres";
import type { Queue } from "@/lib/queue";
import { enqueue } from "./enqueue";

// Sends an order from the failed queue back for delivery, after someone fixed the cause
// (mapped the SKU, corrected the ERP). Only failed orders can be replayed.
export async function replayOrder(sql: Sql, queue: Queue, orderId: number): Promise<boolean> {
  const replayed = await sql.begin(async (tx) => {
    const rows = await tx`UPDATE bridge.orders SET status = 'received', last_error = NULL
      WHERE id = ${orderId} AND status = 'failed' RETURNING id`;
    if (rows.length) await tx`INSERT INTO bridge.replays (order_id) VALUES (${orderId})`;
    return rows.length > 0;
  });
  if (replayed) await enqueue(sql, queue, orderId);
  return replayed;
}
