import { sql } from "@/lib/db";
import { sweep } from "@/lib/bridge/sweep";
import { fromQueue, queue } from "@/lib/services";

// Called by a QStash schedule every 15 minutes. See src/lib/bridge/sweep.ts.
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await fromQueue(request, body))) return Response.json({ error: "invalid_signature" }, { status: 401 });
  const queued = await sweep(sql, queue());
  return Response.json({ queued });
}
