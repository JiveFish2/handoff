import { createHash } from "node:crypto";
import type { Sql } from "@/lib/postgres";

// What the public console lets one visitor do, and the whole demo in a day. The order limit
// also keeps the demo well inside QStash's free daily messages.
export const LIMITS = {
  order: { perClientHour: 5, perDay: 150 },
  fault: { perClientHour: 30, perDay: 1000 },
  replay: { perClientHour: 10, perDay: 300 },
} as const;

export type DemoAction = keyof typeof LIMITS;

export const clientId = (ip: string, salt: string) => createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);

// Checks both limits and, when the action is allowed, records it in the same transaction, so
// two clicks at once cannot both slip under the limit.
export async function takeSlot(sql: Sql, action: DemoAction, client: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const limit = LIMITS[action];
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`demo:${action}`}))`;
    const [counts] = await tx<{ mine: number; all: number }[]>`
      SELECT count(*) FILTER (WHERE client = ${client} AND at > now() - interval '1 hour')::int AS mine,
             count(*) FILTER (WHERE at > now() - interval '1 day')::int AS all
      FROM bridge.demo_actions WHERE action = ${action}`;
    if (counts.all >= limit.perDay) return { ok: false as const, reason: "The demo has reached today's limit. Back tomorrow." };
    if (counts.mine >= limit.perClientHour) {
      return { ok: false as const, reason: `That's ${limit.perClientHour} in an hour from here. Try again a little later.` };
    }
    await tx`INSERT INTO bridge.demo_actions (action, client) VALUES (${action}, ${client})`;
    return { ok: true as const };
  });
}
