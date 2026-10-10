import { sql } from "@/lib/db";
import { runDeliveryJob } from "@/lib/bridge/job";
import { erp, fromQueue } from "@/lib/services";

// Called by QStash with { orderId }. Upstash-Retried says how many times this message has
// been retried, which tells the bridge whether this is its last chance.
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await fromQueue(request, body))) return Response.json({ error: "invalid_signature" }, { status: 401 });

  const orderId = Number((JSON.parse(body) as { orderId?: unknown }).orderId);
  if (!Number.isInteger(orderId)) return Response.json({ error: "invalid_body" }, { status: 400 });

  const retried = Number(request.headers.get("upstash-retried") ?? 0);
  const job = await runDeliveryJob(sql, erp(), { orderId, retried });
  return Response.json(job.body, { status: job.status, headers: job.headers });
}
