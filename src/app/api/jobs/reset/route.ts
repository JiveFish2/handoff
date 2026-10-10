import { sql } from "@/lib/db";
import { resetDemo } from "@/lib/bridge/reset";
import { fromQueue, queue } from "@/lib/services";

// Called by a QStash schedule at 06:45 UTC, before the reconciliation. See src/lib/bridge/reset.ts.
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await fromQueue(request, body))) return Response.json({ error: "invalid_signature" }, { status: 401 });
  const result = await resetDemo(sql);
  if (result.adjusted > 0) await queue().enqueueStockSync();
  return Response.json(result);
}
