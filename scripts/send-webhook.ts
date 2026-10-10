// npm run webhook — sends a signed orders/create webhook to the local bridge, shaped like
// Shopify's, until a real development store is connected.
//
//   --twice        send the same webhook again (a redelivery)
//   --unknown-sku  include a line whose SKU the bridge cannot map
import { randomInt, randomUUID } from "node:crypto";
import { GRINDS, variants } from "../src/catalog";
import { sign } from "../src/lib/shopify/hmac";

const url = process.env.WEBHOOK_URL ?? "http://localhost:3002/api/webhooks/shopify";
const secret = process.env.SHOPIFY_CLIENT_SECRET!;
const args = new Set(process.argv.slice(2));

const pool = variants();
const lines = Array.from({ length: randomInt(1, 4) }, (_, i) => {
  const v = pool[randomInt(pool.length)];
  return {
    id: Date.now() * 10 + i,
    sku: v.shopifySku,
    title: v.title,
    quantity: randomInt(1, 3),
    price: v.price.toFixed(2),
    properties: [{ name: "Grind", value: GRINDS[randomInt(GRINDS.length)] }],
  };
});
if (args.has("--unknown-sku")) {
  lines.push({ id: Date.now() * 10 + 9, sku: "gift-card-25", title: "Gift card", quantity: 1, price: "25.00", properties: [] });
}

const id = Date.now();
const order = {
  id,
  name: `#${1000 + (id % 9000)}`,
  currency: "USD",
  created_at: new Date().toISOString(),
  total_price: lines.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0).toFixed(2),
  line_items: lines,
  // The demo never carries real personal data.
  customer: { first_name: "Demo", last_name: "Customer", email: "demo@example.com" },
};

const body = JSON.stringify(order);
const headers = {
  "Content-Type": "application/json",
  "X-Shopify-Topic": "orders/create",
  "X-Shopify-Hmac-Sha256": sign(body, secret),
  "X-Shopify-Webhook-Id": randomUUID(),
  "X-Shopify-Event-Id": randomUUID(),
  "X-Shopify-Shop-Domain": "kilnhouse-coffee.myshopify.com",
};

for (let i = 0; i < (args.has("--twice") ? 2 : 1); i++) {
  const response = await fetch(url, { method: "POST", headers, body });
  console.log(`${order.name} (${lines.length} lines) → ${response.status} ${await response.text()}`);
}
