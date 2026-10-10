import type { Sql } from "@/lib/postgres";

// The fictional ERP's HTTP API. It behaves like a modest real one: an API key, its own item
// codes, no idempotency keys, and a non-unique external reference. Each fault in erp.faults
// changes how it answers, so the bridge can be watched recovering.

export type FaultMode = "down" | "slow" | "rate_limited" | "response_lost" | "rejects";

type Options = { apiKey: string; slowMs?: number };

const json = (status: number, body: unknown, headers?: HeadersInit) =>
  Response.json(body, { status, headers });
const error = (status: number, code: string, message: string, headers?: HeadersInit) =>
  json(status, { error: code, message }, headers);

type OrderInput = {
  external_ref: string;
  customer_account: string;
  lines: { item_code: string; quantity: number; unit_price: string; note?: string | null }[];
};

function parseOrderInput(value: unknown): OrderInput | null {
  const v = value as OrderInput;
  if (typeof v?.external_ref !== "string" || !v.external_ref) return null;
  if (typeof v.customer_account !== "string" || !Array.isArray(v.lines) || v.lines.length === 0) return null;
  const linesOk = v.lines.every(
    (l) => typeof l.item_code === "string" && Number.isInteger(l.quantity) && l.quantity > 0 && !Number.isNaN(Number(l.unit_price)),
  );
  return linesOk ? v : null;
}

export function erpServer(sql: Sql, { apiKey, slowMs = 12_000 }: Options) {
  async function faults(): Promise<Set<FaultMode>> {
    const rows = await sql<{ mode: FaultMode }[]>`SELECT mode FROM erp.faults WHERE until > now()`;
    return new Set(rows.map((r) => r.mode));
  }

  // What every endpoint does before its own work: check the key, then apply the faults that
  // affect any request. Returns a response to send instead, or the active faults.
  async function gate(request: Request): Promise<Response | Set<FaultMode>> {
    if (request.headers.get("authorization") !== `Bearer ${apiKey}`) {
      return error(401, "unauthorized", "Missing or wrong API key");
    }
    const active = await faults();
    if (active.has("down")) return error(503, "unavailable", "ERP is down for maintenance");
    if (active.has("rate_limited")) {
      return error(429, "rate_limited", "Too many requests", { "Retry-After": "5" });
    }
    if (active.has("slow")) await new Promise((resolve) => setTimeout(resolve, slowMs));
    return active;
  }

  // POST /erp/api/orders
  async function createOrder(request: Request): Promise<Response> {
    const active = await gate(request);
    if (active instanceof Response) return active;

    const input = parseOrderInput(await request.json().catch(() => null));
    if (!input) return error(400, "invalid_body", "external_ref, customer_account and lines are required");

    const codes = input.lines.map((l) => l.item_code);
    const known = new Set(
      (await sql<{ code: string }[]>`SELECT code FROM erp.items WHERE code = ANY(${codes})`).map((r) => r.code),
    );
    const unknown = active.has("rejects") ? codes[0] : codes.find((c) => !known.has(c));
    if (unknown) return error(422, "unknown_item", `Item ${unknown} does not exist`);

    const order = await sql.begin(async (tx) => {
      const total = input.lines.reduce((sum, l) => sum + Number(l.unit_price) * l.quantity, 0);
      const [row] = await tx<{ ref: string; created_at: Date }[]>`
        INSERT INTO erp.orders (external_ref, customer_account, total)
        VALUES (${input.external_ref}, ${input.customer_account}, ${total.toFixed(2)})
        RETURNING ref, created_at`;
      for (const [i, l] of input.lines.entries()) {
        await tx`INSERT INTO erp.order_lines (order_ref, line, item_code, quantity, unit_price, note)
          VALUES (${row.ref}, ${i + 1}, ${l.item_code}, ${l.quantity}, ${l.unit_price}, ${l.note ?? null})`;
        await tx`UPDATE erp.items SET stock = stock - ${l.quantity} WHERE code = ${l.item_code}`;
      }
      return row;
    });

    // The order is committed, but the caller never learns it: the answer is lost on the way.
    if (active.has("response_lost")) return error(504, "gateway_timeout", "Upstream timed out");
    return json(201, { ref: order.ref, external_ref: input.external_ref, created_at: order.created_at });
  }

  // GET /erp/api/orders?external_ref=...
  async function findOrders(request: Request): Promise<Response> {
    const active = await gate(request);
    if (active instanceof Response) return active;
    const ref = new URL(request.url).searchParams.get("external_ref");
    if (!ref) return error(400, "invalid_query", "external_ref is required");
    const orders = await sql`
      SELECT ref, external_ref, customer_account, total, created_at
      FROM erp.orders WHERE external_ref = ${ref} ORDER BY created_at`;
    return json(200, { orders });
  }

  return { createOrder, findOrders };
}
