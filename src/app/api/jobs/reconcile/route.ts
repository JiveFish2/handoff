import { sql } from "@/lib/db";
import { reconcile } from "@/lib/bridge/reconcile";
import { erp, fromQueue, queue, store } from "@/lib/services";

// Called by a QStash schedule once a night. See src/lib/bridge/reconcile.ts.
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.text();
  if (!(await fromQueue(request, body))) return Response.json({ error: "invalid_signature" }, { status: 401 });
  return Response.json(await reconcile(sql, erp(), store(), queue()));
}
