import { Receiver } from "@upstash/qstash";
import { sql } from "@/lib/db";
import { erpClient } from "@/lib/erp/client";
import { erpServer } from "@/lib/erp/server";
import { qstashQueue } from "@/lib/queue";
import { shopifyAdmin, type ShopifyAdmin } from "@/lib/shopify/admin";
import { shopifyStore } from "@/lib/shopify/store";

// Wiring for the running app; tests build the same pieces against their own database.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const erp = () =>
  erpClient({ baseUrl: required("ERP_BASE_URL"), apiKey: required("ERP_API_KEY") });

export const erpApi = () => erpServer(sql, { apiKey: required("ERP_API_KEY") });

export const shopifySecret = () => required("SHOPIFY_CLIENT_SECRET");

export const queue = () =>
  qstashQueue({ token: required("QSTASH_TOKEN"), baseUrl: required("QSTASH_URL"), publicUrl: required("PUBLIC_URL") });

// Only QStash can call the job endpoints: each request carries a JWT signed with these keys
// (two, so Upstash can rotate them without downtime) and bound to the body.
export async function fromQueue(request: Request, body: string): Promise<boolean> {
  const receiver = new Receiver({
    currentSigningKey: required("QSTASH_CURRENT_SIGNING_KEY"),
    nextSigningKey: required("QSTASH_NEXT_SIGNING_KEY"),
  });
  const signature = request.headers.get("upstash-signature");
  if (!signature) return false;
  return receiver.verify({ signature, body, clockTolerance: 5 }).catch(() => false);
}

// One Admin client per server instance, so its 24-hour token is reused between requests.
let admin: ShopifyAdmin | null = null;
export const store = () => {
  admin ??= shopifyAdmin({
    shop: required("SHOPIFY_SHOP"),
    clientId: required("SHOPIFY_CLIENT_ID"),
    clientSecret: required("SHOPIFY_CLIENT_SECRET"),
  });
  return shopifyStore(admin);
};
