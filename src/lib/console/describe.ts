// Turns the bridge's records into the sentences the console shows. Pure, so it is tested.

export type Attempt = {
  number: number;
  outcome: "created" | "found_in_erp" | "failed";
  http_status: number | null;
  error: string | null;
  error_kind: "transient" | "permanent" | null;
  duration_ms: number;
};

export type Tone = "ok" | "warn" | "bad";

// Seconds QStash waits before retry n (n = 0 for the first retry); mirrors RETRY_DELAY.
export const retryDelaySeconds = (retried: number) => Math.min(300, 2 ** retried * 10);

const formatWait = (s: number) => (s < 60 ? `${s} s` : `${Math.round(s / 60)} min`);

const FAILURES: Record<number, string> = {
  503: "ERP down (503)",
  429: "ERP rate limit (429)",
  504: "No answer from the ERP gateway (504)",
  502: "ERP gateway error (502)",
  500: "ERP error (500)",
};

// `retried` is how many retries came before this attempt in its run through the queue (a
// replay starts a new run). `orderStatus` is where the order is now.
export function describeAttempt(
  a: Attempt,
  { retried, isLast, orderStatus }: { retried: number; isLast: boolean; orderStatus: string },
): { tone: Tone; title: string; detail: string } {
  if (a.outcome === "created") return { tone: "ok", title: "Created in the ERP", detail: `${a.duration_ms} ms` };
  if (a.outcome === "found_in_erp") return { tone: "ok", title: "Found in the ERP, not created twice", detail: `${a.duration_ms} ms` };

  const title =
    a.http_status === null ? (a.error?.startsWith("No ERP item") ? a.error : (a.error ?? "No answer"))
    : a.http_status === 422 ? `ERP refused: ${a.error?.replace(/^ERP answered 422: /, "") ?? "invalid data"} (422)`
    : FAILURES[a.http_status] ?? `ERP answered ${a.http_status}`;

  if (a.error_kind === "permanent") return { tone: "bad", title, detail: "permanent · sent to the failed queue" };
  if (isLast && orderStatus === "failed") return { tone: "bad", title, detail: "out of tries · sent to the failed queue" };
  return { tone: "warn", title, detail: isLast ? `transient · next try in ${formatWait(retryDelaySeconds(retried))}` : `transient · retried after ${formatWait(retryDelaySeconds(retried))}` };
}

export const utcTime = (d: Date) => d.toISOString().slice(11, 19);
