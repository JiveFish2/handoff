import { GRINDS, variants } from "@/catalog";
import type { ShopifyAdmin } from "./admin";

// Places a demo order in the store through the Admin API, the same way the console's
// "Place a test order" button will. Shopify then sends the orders/create webhook as for any
// other order. No customer is attached: the demo never carries personal data.
export async function placeTestOrder(admin: ShopifyAdmin, random: (n: number) => number = (n) => Math.floor(Math.random() * n)) {
  const pool = variants();
  const picks = Array.from({ length: 1 + random(3) }, () => pool[random(pool.length)]);
  const skus = [...new Set(picks.map((p) => p.shopifySku))];

  const { productVariants } = await admin.graphql<{ productVariants: { nodes: { id: string; sku: string }[] } }>(
    `query ($query: String!) { productVariants(first: 10, query: $query) { nodes { id sku } } }`,
    { query: skus.map((s) => `sku:${s}`).join(" OR ") },
  );
  const idBySku = new Map(productVariants.nodes.map((v) => [v.sku, v.id]));

  const { orderCreate } = await admin.graphql<{
    orderCreate: { order: { id: string; name: string } | null; userErrors: { field: string[]; message: string }[] };
  }>(
    `mutation ($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order { id name }
        userErrors { field message }
      }
    }`,
    {
      order: {
        currency: "USD",
        financialStatus: "PAID",
        note: "Demo order placed by Handoff.",
        tags: ["handoff-demo"],
        lineItems: skus.map((sku) => ({
          variantId: idBySku.get(sku),
          quantity: 1 + random(2),
          properties: [{ name: "Grind", value: GRINDS[random(GRINDS.length)] }],
        })),
      },
      options: { inventoryBehaviour: "DECREMENT_OBEYING_POLICY", sendReceipt: false, sendFulfillmentReceipt: false },
    },
  );
  if (orderCreate.userErrors.length || !orderCreate.order) {
    throw new Error(orderCreate.userErrors.map((e) => `${e.field?.join(".")} ${e.message}`).join("; "));
  }
  return orderCreate.order;
}
