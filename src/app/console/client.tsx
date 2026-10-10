"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { placeOrder, replay, setFault, type ActionResult } from "@/app/actions";

// Re-reads the console every few seconds while the tab is visible, so a webhook, a retry or a
// recovery shows up without a reload.
export function AutoRefresh({ seconds = 4 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

function Message({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className="text-[13px] leading-snug" style={{ color: result.ok ? "var(--mute)" : "var(--warn)" }}>
      {result.message}
    </p>
  );
}

export function PlaceOrder() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="grid justify-items-end gap-1.5">
      <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setResult(await placeOrder()))}>
        {pending ? "Placing…" : "Place a test order"}
      </button>
      <Message result={result} />
    </div>
  );
}

const minutesLeft = (until: string) => Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000));

export function FaultSwitch({ mode, name, what, until }: { mode: string; name: string; what: string; until: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const on = until !== null;
  return (
    <div className="grid gap-1">
      <button
        type="button"
        aria-pressed={on}
        disabled={pending}
        onClick={() => start(async () => setResult(await setFault(mode, !on)))}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-[6px] border px-2.5 py-2 text-left"
        style={{ borderColor: on ? "var(--bad)" : "var(--line)", cursor: pending ? "progress" : "pointer" }}
      >
        <span>
          <b className="block text-[14px] font-semibold leading-tight">{name}</b>
          <small className="mono text-[12px]" style={{ color: on ? "var(--bad)" : "var(--mute)" }}>
            {on ? `on · off by itself in ${minutesLeft(until)} min` : what}
          </small>
        </span>
        <span aria-hidden className="relative h-5 w-[34px] rounded-full transition-colors" style={{ background: on ? "var(--bad)" : "var(--line)" }}>
          <span className="absolute top-[3px] h-3.5 w-3.5 rounded-full transition-[left]" style={{ left: on ? 17 : 3, background: "var(--bg)" }} />
        </span>
      </button>
      {result && !result.ok && <Message result={result} />}
    </div>
  );
}

export function ReplayButton({ orderId }: { orderId: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <span className="grid justify-items-end gap-1">
      <button type="button" className="btn ghost !px-2.5 !py-1.5 !text-[13px]" disabled={pending} onClick={() => start(async () => setResult(await replay(orderId)))}>
        {pending ? "Sending…" : "Replay"}
      </button>
      {result && !result.ok && <Message result={result} />}
    </span>
  );
}
