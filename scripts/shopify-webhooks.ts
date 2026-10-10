// npm run shopify:webhooks -- <public base URL>
// Points the store's orders/create webhook at this bridge. Replaces any earlier subscription
// for the same topic, so it can be run again whenever the address changes (a new tunnel in
// development, the real domain in production).
// npm run shopify:webhooks -- --off removes it (to watch the reconciliation catch the orders).
import { shopifyAdmin } from "../src/lib/shopify/admin";

const off = process.argv[2] === "--off";
const base = process.argv[2]?.replace(/\/$/, "");
if (!off && !base?.startsWith("https://")) throw new Error("Usage: npm run shopify:webhooks -- https://<public host> | --off");
const callbackUrl = `${base}/api/webhooks/shopify`;

const admin = shopifyAdmin({
  shop: process.env.SHOPIFY_SHOP!,
  clientId: process.env.SHOPIFY_CLIENT_ID!,
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET!,
});

type UserErrors = { userErrors: { message: string }[] };

const existing = await admin.graphql<{ webhookSubscriptions: { nodes: { id: string; uri: string }[] } }>(
  `{ webhookSubscriptions(first: 20, topics: [ORDERS_CREATE]) { nodes { id uri } } }`,
);
for (const sub of existing.webhookSubscriptions.nodes) {
  if (!off && sub.uri === callbackUrl) {
    console.log(`Already subscribed: ${callbackUrl}`);
    process.exit(0);
  }
  const { webhookSubscriptionDelete } = await admin.graphql<{ webhookSubscriptionDelete: UserErrors }>(
    `mutation ($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`,
    { id: sub.id },
  );
  console.log(`Removed ${sub.uri}${webhookSubscriptionDelete.userErrors.length ? " (with errors)" : ""}`);
}

if (off) process.exit(0);

const { webhookSubscriptionCreate } = await admin.graphql<{
  webhookSubscriptionCreate: UserErrors & { webhookSubscription: { id: string } | null };
}>(
  `mutation ($sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: ORDERS_CREATE, webhookSubscription: $sub) {
      webhookSubscription { id }
      userErrors { message }
    }
  }`,
  { sub: { uri: callbackUrl, format: "JSON" } },
);
if (webhookSubscriptionCreate.userErrors.length) {
  throw new Error(webhookSubscriptionCreate.userErrors.map((e) => e.message).join("; "));
}
console.log(`Subscribed orders/create → ${callbackUrl}`);
