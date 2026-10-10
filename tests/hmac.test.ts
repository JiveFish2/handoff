import { describe, expect, it } from "vitest";
import { sign, verifyWebhook } from "@/lib/shopify/hmac";

const secret = "shhh";
const body = '{"id":1,"name":"#1001"}';

describe("verifyWebhook", () => {
  it("accepts the signature Shopify would send", () => {
    expect(verifyWebhook(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a body changed by a single byte", () => {
    expect(verifyWebhook(body.replace("1001", "1002"), sign(body, secret), secret)).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyWebhook(body, sign(body, "other"), secret)).toBe(false);
  });

  it("rejects a missing or malformed header without throwing", () => {
    expect(verifyWebhook(body, null, secret)).toBe(false);
    expect(verifyWebhook(body, "not-base64!", secret)).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    expect(verifyWebhook(body, sign(body, ""), "")).toBe(false);
  });
});
