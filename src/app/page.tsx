import Link from "next/link";
import { Suspense } from "react";
import { sql } from "@/lib/db";
import { consoleData, orderTrail, type ConsoleOrder } from "@/lib/console/data";
import { describeAttempt, utcTime } from "@/lib/console/describe";
import { LIMITS } from "@/lib/demo/limits";
import { Logo } from "@/components/Logo";
import { AutoRefresh, FaultSwitch, PlaceOrder, ReplayButton, TourButton } from "./console/client";

// The ops console: what the bridge is doing right now, one order's trail, and the switches
// that break the ERP on purpose.

const FAULTS = [
  ["down", "Down", "503 on every call"],
  ["slow", "Slow", "answers after the timeout"],
  ["rate_limited", "Rate limited", "429, Retry-After 5 s"],
  ["response_lost", "Answer lost", "saves the order, then 504"],
  ["rejects", "Rejects data", "422, goes to the failed queue"],
] as const;

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto grid w-full max-w-[1360px] gap-4 px-4 py-5 sm:px-6">
      <Suspense fallback={<Frame><p className="p-5 text-[14px]" style={{ color: "var(--mute)" }}>Reading the bridge…</p></Frame>}>
        <Console searchParams={searchParams} />
      </Suspense>
      <About />
    </main>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[10px] border" style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
      {children}
    </section>
  );
}

function pill(o: ConsoleOrder): [string, string] {
  if (o.status === "failed") return ["bad", "failed queue"];
  if (o.status === "retrying") return ["warn", "retrying"];
  if (o.status !== "delivered") return ["info", "in flight"];
  if (o.viaReconcile) return ["info", "caught by reconcile"];
  if (o.replays > 0) return ["info", "replayed"];
  if (o.attempts > 1) return ["warn", `${o.attempts} tries`];
  return ["ok", "delivered"];
}

async function Console({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const params = await searchParams;
  const data = await consoleData(sql);
  const wanted = typeof params.order === "string" ? `#${params.order.replace(/^#/, "")}` : null;
  const selected = data.orders.find((o) => o.name === wanted) ?? data.orders[0] ?? null;
  const trail = selected ? await orderTrail(sql, selected.id) : [];
  const failed = data.orders.filter((o) => o.status === "failed");
  const { stats, reconciliation: rec } = data;
  const faultsOn = data.faults.size;

  const status =
    faultsOn > 0 ? { tone: "var(--bad)", text: `${faultsOn} ERP fault${faultsOn > 1 ? "s" : ""} on` }
    : stats.failed > 0 ? { tone: "var(--warn)", text: `${stats.failed} in the failed queue` }
    : { tone: "var(--ok)", text: "Bridge healthy" };

  return (
    <Frame>
      <AutoRefresh />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="inline-flex items-center gap-2 text-[21px] font-semibold tracking-[.01em]">
            <Logo size={24} /> Handoff
          </h1>
          <span className="mono text-[13px]" style={{ color: "var(--mute)" }}>Shopify → ERP bridge · Kilnhouse Coffee demo</span>
        </div>
        <span className="mono inline-flex items-center gap-2 text-[13px]">
          <i className={faultsOn ? "pulse" : ""} style={{ width: 8, height: 8, borderRadius: 99, background: status.tone, boxShadow: `0 0 0 3px color-mix(in srgb, ${status.tone} 25%, transparent)` }} />
          {status.text}
        </span>
        <div className="flex flex-wrap items-start gap-2">
          <TourButton />
          <PlaceOrder />
        </div>
      </header>

      <dl className="grid grid-cols-2 border-b sm:grid-cols-3 lg:grid-cols-5" style={{ borderColor: "var(--line)" }}>
        <Stat label="Orders, 24 h" value={String(stats.orders)} note={`${stats.in_erp} in the ERP`} />
        <Stat label="First try" value={`${stats.first_try} / ${stats.orders}`} note={stats.orders - stats.first_try > 0 ? "the rest retried" : "no retries needed"} />
        <Stat label="Retries" value={String(Math.max(0, stats.retries))} note={`${stats.duplicates} duplicates in the ERP`} />
        <Stat label="Failed queue" value={String(stats.failed)} note={`${stats.replays} replayed, 24 h`} />
        <Stat
          wide
          label="Last reconcile"
          value={rec?.finished_at ? utcTime(rec.finished_at).slice(0, 5) : "—"}
          note={rec ? (rec.error ? "failed, see logs" : `${plural(rec.orders_missing ?? 0, "lost webhook")} · ${plural(rec.stock_fixed ?? 0, "stock fix", "stock fixes")}`) : "not run yet"}
        />
      </dl>

      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,.8fr)]">
        <Column title="Orders" aside="newest first · UTC">
          {data.orders.length === 0 && <Empty>No orders yet. Place a test order to start.</Empty>}
          <nav className="grid" aria-label="Orders">
            {data.orders.map((o) => {
              const [tone, text] = pill(o);
              const current = o.id === selected?.id;
              return (
                <Link
                  key={o.id}
                  href={`/?order=${o.name.slice(1)}`}
                  scroll={false}
                  aria-current={current ? "true" : undefined}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-5 py-2.5"
                  style={{ borderColor: "var(--line-soft)", background: current ? "var(--sel)" : undefined }}
                >
                  <span className="mono text-[13px]" style={{ color: "var(--mute)" }}>{utcTime(o.receivedAt)}</span>
                  <span className="mono text-[15px] font-semibold">
                    {o.name} <span className="font-normal" style={{ color: "var(--mute)" }}>→ {o.erpRef ?? "…"}</span>
                  </span>
                  <span className={`pill ${tone}`}>{text}</span>
                  <span className="col-start-2 col-end-4 text-[13px] leading-snug" style={{ color: "var(--mute)" }}>
                    {o.items} · ${o.total}
                  </span>
                </Link>
              );
            })}
          </nav>
        </Column>

        <Column title="Trail" aside={selected?.name ?? ""}>
          {selected ? (
            <div className="grid gap-3 px-5 pb-5 pt-1">
              <div className="grid gap-1">
                <b className="text-[22px] font-semibold leading-tight">{selected.name} → {selected.erpRef ?? "not in the ERP yet"}</b>
                <span className="text-[13.5px] leading-snug" style={{ color: "var(--mute)" }}>{selected.items} · ${selected.total}</span>
              </div>
              <ol className="grid">
                {trail.map((e, i) => {
                  const last = i === trail.length - 1;
                  let tone = "info", title = "", detail = "";
                  if (e.kind === "received") {
                    title = e.viaReconcile ? "Found by the nightly check" : "Webhook received";
                    detail = e.viaReconcile ? "its webhook never arrived" : "signature checked";
                  } else if (e.kind === "replay") {
                    title = "Replayed from the failed queue";
                    detail = "sent back to the queue";
                  } else {
                    const isLastAttempt = !trail.slice(i + 1).some((x) => x.kind === "attempt");
                    ({ tone, title, detail } = describeAttempt(e.attempt, { retried: e.retried, isLast: isLastAttempt, orderStatus: selected.status }));
                    title = `Try ${e.attempt.number}: ${title}`;
                  }
                  return (
                    <li key={i} className="relative grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2.5 pb-3">
                      {!last && <span aria-hidden className="absolute bottom-0 left-2 top-4 w-0.5" style={{ background: "var(--line)" }} />}
                      <span
                        aria-hidden
                        className="relative z-10 h-[18px] w-[18px] rounded-full border-2"
                        style={{
                          borderColor: tone === "info" ? "var(--mute)" : `var(--${tone})`,
                          background: tone === "ok" ? "var(--ok)" : "var(--bg)",
                        }}
                      />
                      <p className="text-[14px] leading-snug">
                        {title}
                        <small className="mono block text-[12.5px]" style={{ color: "var(--mute)" }}>{detail}</small>
                      </p>
                      <time className="mono text-[12.5px]" style={{ color: "var(--mute)" }}>{utcTime(e.at)}</time>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <Empty>Pick an order to see each step it took.</Empty>
          )}
        </Column>

        <Column title="Break the ERP" aside="3 min each">
          <div className="grid gap-2 px-5 pb-4">
            {FAULTS.map(([mode, name, what]) => (
              <FaultSwitch key={mode} mode={mode} name={name} what={what} until={data.faults.get(mode)?.toISOString() ?? null} />
            ))}
          </div>
          <h2 className="label px-5 pb-2 pt-2">Failed queue</h2>
          {failed.length === 0 ? (
            <Empty>Empty. An order lands here when the ERP refuses it or it runs out of tries.</Empty>
          ) : (
            <ul className="grid gap-2 px-5 pb-4">
              {failed.map((o) => (
                <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <Link href={`/?order=${o.name.slice(1)}`} scroll={false} className="mono text-[14px] font-semibold">{o.name}</Link>
                  <ReplayButton orderId={o.id} />
                </li>
              ))}
            </ul>
          )}
          <h2 className="label px-5 pb-2 pt-2">Last reconciliation</h2>
          {rec ? (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-5 pb-5 text-[13.5px]">
              <Row k="Store orders checked" v={rec.orders_checked ?? "—"} />
              <Row k="Missing, taken in" v={rec.details?.missingOrders?.join(", ") || "none"} />
              <Row k="Stock checked" v={rec.stock_checked ?? "—"} />
              <Row k="Stock corrected" v={rec.stock_fixed ?? "—"} />
            </dl>
          ) : (
            <Empty>Runs every night at 07:00 UTC.</Empty>
          )}
        </Column>
      </div>

      <footer className="mono flex flex-wrap justify-between gap-x-4 gap-y-1.5 border-t px-5 py-2.5 text-[12.5px]" style={{ borderColor: "var(--line)", color: "var(--mute)" }}>
        <span>Kilnhouse Coffee is a fictional company. Demo store, nothing is sold.</span>
        <span>{LIMITS.order.perClientHour} test orders per hour · faults switch off on their own</span>
      </footer>
    </Frame>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Stat({ label, value, note, wide }: { label: string; value: string; note: string; wide?: boolean }) {
  return (
    <div className={`grid gap-1 border-b border-r px-5 py-3.5 lg:border-b-0 ${wide ? "col-span-2 sm:col-span-1" : ""}`} style={{ borderColor: "var(--line)" }}>
      <dt className="label">{label}</dt>
      <dd className="mono text-[24px] font-semibold leading-tight" style={{ color: "var(--bright)" }}>{value}</dd>
      <dd className="text-[13px]" style={{ color: "var(--mute)" }}>{note}</dd>
    </div>
  );
}

function Column({ title, aside, children }: { title: string; aside: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 content-start border-b lg:border-b-0 lg:border-r lg:last:border-r-0" style={{ borderColor: "var(--line)" }}>
      <h2 className="label flex justify-between gap-2 px-5 pb-2.5 pt-3.5">
        {title} <span className="normal-case tracking-normal">{aside}</span>
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 pb-4 text-[13.5px] leading-normal" style={{ color: "var(--mute)" }}>{children}</p>;
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <>
      <dt style={{ color: "var(--mute)" }}>{k}</dt>
      <dd className="mono text-right">{v}</dd>
    </>
  );
}

function About() {
  return (
    <section className="grid gap-3 px-1 text-[14px] leading-relaxed" style={{ color: "var(--mute)", maxWidth: "72ch" }}>
      <h2 className="label">How to try it</h2>
      <p>
        Every order placed in the Kilnhouse store reaches the bridge as a signed webhook, waits in a queue and is written to
        the ERP. The ERP never gets the same order twice, and a nightly check catches any webhook that never arrived.
      </p>
      <ol className="grid list-decimal gap-1.5 pl-5">
        <li>Switch a fault on under Break the ERP, for example Down.</li>
        <li>Place a test order and click it to follow its trail.</li>
        <li>Watch the bridge retry, waiting longer each time, then switch the fault off.</li>
        <li>Try Rejects data: the order goes to the failed queue until you replay it.</li>
      </ol>
      <p>Kilnhouse Coffee is a fictional roaster. The store is a real Shopify development store; the ERP is part of this demo.</p>
    </section>
  );
}
