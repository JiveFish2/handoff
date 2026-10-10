import type { Sql } from "@/lib/postgres";
import type { Queue } from "@/lib/queue";
import { enqueue } from "./enqueue";

// The safety net, run on a schedule. Finds orders the queue no longer knows about and hands
// them to it again:
// - received but never queued (the queue was unreachable when the webhook arrived);
// - stuck in delivering (the function running the try died);
// - waiting in retrying long after the last retry was due (the message was lost).
// Delivery is idempotent, so queueing an order twice costs a try, never a duplicate.
export async function sweep(sql: Sql, queue: Queue, limit = 20): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`
    SELECT o.id FROM bridge.orders o
    WHERE coalesce(o.queued_at, o.received_at) < now() - interval '2 minutes'
      AND (o.status = 'received'
           OR (o.status = 'delivering' AND o.claimed_at < now() - interval '5 minutes')
           OR (o.status = 'retrying' AND (SELECT max(started_at) FROM bridge.attempts a WHERE a.order_id = o.id)
                                         < now() - interval '15 minutes'))
    ORDER BY o.received_at
    LIMIT ${limit}`;
  for (const row of rows) await enqueue(sql, queue, row.id);
  return rows.map((r) => r.id);
}
