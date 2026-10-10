import { sql } from "@/lib/db";
import { syncStock } from "@/lib/bridge/stock";
import { erp, fromQueue, store } from "@/lib/services";

// Called by QStash after each delivered order and on a schedule. A failure answers 500, so
// QStash tries again; the cursor has not moved, so nothing is skipped.
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await fromQueue(request, body))) return Response.json({ error: "invalid_signature" }, { status: 401 });
  const pushed = await syncStock(sql, erp(), store());
  return Response.json({ pushed });
}
