import { randomUUID } from "node:crypto";
import type { ShopifyAdmin } from "./admin";
import type { ShopifyOrder } from "./order";

// What the bridge needs from the store, behind one small interface: stock levels, setting
// them, and the recent orders (to catch webhooks that never arrived). The tests use an
// in-memory version; another store platform would be another implementation.
export type StoreLevel = { sku: string; inventoryItemId: string; available: number };

export type Store = {
  levels(): Promise<StoreLevel[]>;
  setAvailable(items: { inventoryItemId: string; quantity: number }[], reference: string): Promise<void>;
  ordersSince(since: Date): Promise<ShopifyOrder[]>;
};

type Money = { shopMoney: { amount: string } };
type GqlOrder = {
  legacyResourceId: string;
  name: string;
  createdAt: string;
  currencyCode: string;
  totalPriceSet: Money;
  lineItems: {
    nodes: { id: string; sku: string | null; title: string; quantity: number; originalUnitPriceSet: Money; customAttributes: { key: string; value: string }[] }[];
  };
};

// GraphQL returns orders in a different shape from the webhook; convert to the webhook's, so
// an order found by the reconciliation goes through exactly the same path as any other.
export function toWebhookShape(order: GqlOrder): ShopifyOrder {
  return {
    id: Number(order.legacyResourceId),
    name: order.name,
    currency: order.currencyCode,
    total_price: order.totalPriceSet.shopMoney.amount,
    created_at: order.createdAt,
    line_items: order.lineItems.nodes.map((item) => ({
      id: Number(item.id.split("/").pop()),
      sku: item.sku,
      title: item.title,
      quantity: item.quantity,
      price: item.originalUnitPriceSet.shopMoney.amount,
      properties: item.customAttributes.map((a) => ({ name: a.key, value: a.value })),
    })),
  };
}

export function shopifyStore(admin: ShopifyAdmin): Store {
  let locationId: string | null = null;
  async function location() {
    if (!locationId) {
      const data = await admin.graphql<{ locations: { nodes: { id: string }[] } }>(`{ locations(first: 1) { nodes { id } } }`);
      locationId = data.locations.nodes[0].id;
    }
    return locationId;
  }

  return {
    async levels() {
      const data = await admin.graphql<{
        productVariants: {
          nodes: { sku: string | null; inventoryItem: { id: string; inventoryLevel: { quantities: { quantity: number }[] } | null } }[];
        };
      }>(
        `query ($location: ID!) {
          productVariants(first: 100) {
            nodes { sku inventoryItem { id inventoryLevel(locationId: $location) { quantities(names: ["available"]) { quantity } } } }
          }
        }`,
        { location: await location() },
      );
      return data.productVariants.nodes
        .filter((v) => v.sku && v.inventoryItem.inventoryLevel)
        .map((v) => ({
          sku: v.sku!,
          inventoryItemId: v.inventoryItem.id,
          available: v.inventoryItem.inventoryLevel!.quantities[0]?.quantity ?? 0,
        }));
    },

    // Sets absolute quantities. No compare-and-set: the ERP is the source of truth, so its
    // number wins whatever the store had. Shopify requires an idempotency key on this call.
    async setAvailable(items, reference) {
      if (items.length === 0) return;
      const loc = await location();
      const { inventorySetQuantities } = await admin.graphql<{
        inventorySetQuantities: { userErrors: { field: string[]; message: string }[] };
      }>(
        `mutation ($input: InventorySetQuantitiesInput!, $key: String!) {
          inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { field message } }
        }`,
        {
          key: randomUUID(),
          input: {
            name: "available",
            reason: "correction",
            referenceDocumentUri: reference,
            quantities: items.map((i) => ({ inventoryItemId: i.inventoryItemId, locationId: loc, quantity: i.quantity, changeFromQuantity: null })),
          },
        },
      );
      if (inventorySetQuantities.userErrors.length) {
        throw new Error(inventorySetQuantities.userErrors.map((e) => `${e.field?.join(".")} ${e.message}`).join("; "));
      }
    },

    async ordersSince(since) {
      const data = await admin.graphql<{ orders: { nodes: GqlOrder[] } }>(
        `query ($query: String!) {
          orders(first: 100, query: $query, sortKey: CREATED_AT) {
            nodes {
              legacyResourceId name createdAt currencyCode
              totalPriceSet { shopMoney { amount } }
              lineItems(first: 50) {
                nodes { id sku title quantity originalUnitPriceSet { shopMoney { amount } } customAttributes { key value } }
              }
            }
          }
        }`,
        { query: `created_at:>='${since.toISOString()}'` },
      );
      return data.orders.nodes.map(toWebhookShape);
    },
  };
}
