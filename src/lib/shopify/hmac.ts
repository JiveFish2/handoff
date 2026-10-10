import { createHmac, timingSafeEqual } from "node:crypto";

// Shopify signs every webhook with the app's client secret: a base64 HMAC-SHA256 of the raw
// request body, sent in X-Shopify-Hmac-Sha256. The body must be the exact bytes received,
// before any JSON parsing, and the comparison must take the same time whatever matches.
export function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

export function verifyWebhook(body: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(sign(body, secret), "base64");
  const received = Buffer.from(header, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
