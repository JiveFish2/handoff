"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
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

// "Watch the tour": the walkthrough in a dialog over the console. The video loads only when
// the dialog opens and stops when it closes.
export function TourButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const open = () => {
    dialog.current?.showModal();
    video.current?.play().catch(() => {});
  };
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" className="btn ghost inline-flex items-center gap-2" onClick={open}>
        <svg aria-hidden viewBox="0 0 12 12" width="10" height="10"><path d="M2 1.2v9.6L10.4 6z" fill="currentColor" /></svg>
        Watch the tour <span className="mono text-[12px]" style={{ color: "var(--mute)" }}>76 s</span>
      </button>
      <dialog
        ref={dialog}
        aria-label="Handoff walkthrough"
        onClose={() => video.current?.pause()}
        onClick={(e) => { if (e.target === dialog.current) close(); }}
        className="m-auto w-[min(1180px,calc(100vw-32px))] overflow-visible bg-transparent p-0 backdrop:bg-black/75 backdrop:backdrop-blur-[2px]"
      >
        <div className="grid gap-3 rounded-[10px] border p-3 sm:p-4" style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--fg)" }}>
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="label">How Handoff works · 76 s</p>
            <button type="button" className="btn ghost !px-2.5 !py-1.5 !text-[13px]" onClick={close} autoFocus>
              Close
            </button>
          </div>
          <video
            ref={video}
            className="aspect-video w-full rounded-[6px]"
            style={{ background: "var(--bg)" }}
            src="/walkthrough.mp4"
            poster="/walkthrough.jpg"
            controls
            playsInline
            preload="none"
          />
          <p className="px-1 text-[13px]" style={{ color: "var(--mute)" }}>
            Built from this console&apos;s real screens. Waits are sped up. Close it and try the same steps yourself.
          </p>
        </div>
      </dialog>
    </>
  );
}
