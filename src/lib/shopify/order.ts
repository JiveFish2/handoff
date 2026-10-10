// The fields of Shopify's orders/create payload that the bridge uses. The full payload is
// stored as received; everything else (customer, addresses) is ignored on purpose.
export type ShopifyLineItem = {
  id: number;
  sku: string | null;
  title: string;
  quantity: number;
  price: string;
  properties?: { name: string; value: string }[];
};

export type ShopifyOrder = {
  id: number;
  name: string;
  currency: string;
  total_price: string;
  created_at: string;
  line_items: ShopifyLineItem[];
};

export function parseOrder(value: unknown): ShopifyOrder {
  const order = value as ShopifyOrder;
  if (typeof order?.id !== "number" || typeof order.name !== "string" || !Array.isArray(order.line_items)) {
    throw new Error("Not an order payload");
  }
  return order;
}
