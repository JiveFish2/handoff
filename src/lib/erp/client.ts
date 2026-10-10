import type { ErpLine } from "@/lib/bridge/mapping";

// The bridge's side of the ERP API. Every failure becomes an ErpError carrying what the
// bridge needs to decide what to do next: the HTTP status (null when no answer came back at
// all) and, for rate limits, how long the ERP asked us to wait.

export class ErpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export type ErpOrder = { ref: string; external_ref: string; created_at: string };

type Options = { baseUrl: string; apiKey: string; timeoutMs?: number; fetch?: typeof fetch };

export function erpClient({ baseUrl, apiKey, timeoutMs = 8_000, fetch: doFetch = fetch }: Options) {
  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
      throw new ErpError(timedOut ? `No answer within ${timeoutMs} ms` : `Network error: ${String(cause)}`, null);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const message = (body as { message?: string } | null)?.message ?? response.statusText;
      throw new ErpError(`ERP answered ${response.status}: ${message}`, response.status, retryAfter > 0 ? retryAfter : null);
    }
    return body;
  }

  return {
    createOrder: async (input: { external_ref: string; customer_account: string; lines: ErpLine[] }) =>
      (await call("/orders", { method: "POST", body: JSON.stringify(input) })) as ErpOrder,
    findOrders: async (externalRef: string) =>
      ((await call(`/orders?external_ref=${encodeURIComponent(externalRef)}`)) as { orders: ErpOrder[] }).orders,
  };
}

export type ErpClient = ReturnType<typeof erpClient>;
