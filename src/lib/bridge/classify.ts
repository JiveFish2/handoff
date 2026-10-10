import { ErpError } from "@/lib/erp/client";
import { UnmappedSkuError } from "./mapping";

export type ErrorKind = "transient" | "permanent";

// Decides whether trying again can help. Transient: no answer at all (timeout, network),
// rate limits, request timeouts and server errors; the same request may well work later.
// Permanent: the ERP understood the request and refused it, or the bridge cannot even build
// it; retrying would fail the same way until someone fixes the data or the setup.
export function classify(error: unknown): ErrorKind {
  if (error instanceof UnmappedSkuError) return "permanent";
  if (error instanceof ErpError) {
    if (error.status === null || error.status === 408 || error.status === 429 || error.status >= 500) return "transient";
    return "permanent";
  }
  // Anything else (a dropped database connection, a bug) is worth another try; if it keeps
  // happening the order runs out of tries and lands in the failed queue anyway.
  return "transient";
}
