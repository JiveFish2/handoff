import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { START_STOCK } from "@/catalog";
import { resetDemo } from "@/lib/bridge/reset";
import { describeAttempt, retryDelaySeconds, type Attempt } from "@/lib/console/describe";
import { clientId, LIMITS, takeSlot } from "@/lib/demo/limits";
import { fault, reset, sql } from "./helpers";

beforeEach(reset);
afterAll(() => sql.end());

const failed = (http_status: number | null, error: string, error_kind: Attempt["error_kind"] = "transient"): Attempt =>
  ({ number: 1, outcome: "failed", http_status, error, error_kind, duration_ms: 12 });

describe("describeAttempt", () => {
  it("explains a transient failure and the wait that followed it", () => {
    expect(describeAttempt(failed(503, "ERP answered 503: down"), { retried: 2, isLast: false, orderStatus: "delivered" }))
      .toEqual({ tone: "warn", title: "ERP down (503)", detail: "transient · retried after 40 s" });
  });

  it("announces the next try on the latest failure of an order still retrying", () => {
    expect(describeAttempt(failed(429, "x"), { retried: 4, isLast: true, orderStatus: "retrying" }).detail)
      .toBe("transient · next try in 3 min");
  });

  it("says when an order ran out of tries", () => {
    expect(describeAttempt(failed(null, "No answer within 8000 ms"), { retried: 6, isLast: true, orderStatus: "failed" }))
      .toEqual({ tone: "bad", title: "No answer within 8000 ms", detail: "out of tries · sent to the failed queue" });
  });

  it("quotes the ERP's reason for a refusal", () => {
    const d = describeAttempt(failed(422, "ERP answered 422: Item KH-COL-250 does not exist", "permanent"), { retried: 0, isLast: true, orderStatus: "failed" });
    expect(d).toEqual({ tone: "bad", title: "ERP refused: Item KH-COL-250 does not exist (422)", detail: "permanent · sent to the failed queue" });
  });

  it("matches the queue's retry delays", () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelaySeconds)).toEqual([10, 20, 40, 80, 160, 300]);
  });
});

describe("takeSlot", () => {
  it("allows a visitor a few orders an hour, then says no", async () => {
    const me = clientId("203.0.113.7", "salt");
    for (let i = 0; i < LIMITS.order.perClientHour; i++) expect((await takeSlot(sql, "order", me)).ok).toBe(true);
    expect(await takeSlot(sql, "order", me)).toMatchObject({ ok: false });
    expect((await takeSlot(sql, "order", clientId("198.51.100.2", "salt"))).ok).toBe(true);
  });

  it("stops everyone once the day's total is reached", async () => {
    await sql`INSERT INTO bridge.demo_actions (action, client) SELECT 'order', 'c' || g FROM generate_series(1, ${LIMITS.order.perDay}) g`;
    expect(await takeSlot(sql, "order", clientId("203.0.113.7", "salt"))).toEqual({ ok: false, reason: "The demo has reached today's limit. Back tomorrow." });
  });

  it("never stores the address itself", () => {
    expect(clientId("203.0.113.7", "salt")).not.toContain("203.0.113.7");
    expect(clientId("203.0.113.7", "salt")).toHaveLength(32);
  });
});

describe("resetDemo", () => {
  it("switches faults off and puts the ERP's stock back, booked as adjustments", async () => {
    await fault("down");
    await sql`UPDATE erp.items SET stock = 3 WHERE code = 'KH-ETH-250'`;
    expect(await resetDemo(sql)).toEqual({ adjusted: 1 });
    expect(await sql`SELECT count(*)::int AS n FROM erp.faults`).toEqual([{ n: 0 }]);
    expect(await sql`SELECT stock FROM erp.items WHERE code = 'KH-ETH-250'`).toEqual([{ stock: START_STOCK["250"] }]);
    expect(await sql`SELECT delta, reason FROM erp.stock_adjustments`).toEqual([{ delta: START_STOCK["250"] - 3, reason: "Nightly demo reset" }]);
  });
});
