import type { Sql } from "@/lib/postgres";
import type { ShopifyOrder } from "@/lib/shopify/order";

export type Received =
  | { kind: "new"; orderId: number }
  | { kind: "duplicate_webhook"; orderId: number | null }
  | { kind: "duplicate_order"; orderId: number };

// Records an orders/create webhook. Two layers of protection against doing the work twice:
// the webhook ID catches Shopify redelivering the same webhook, and the order ID catches two
// different webhooks about the same order. Only a "new" result should be delivered.
export async function receiveOrder(
  sql: Sql,
  input: { webhookId: string; eventId: string | null; topic: string; shopDomain: string | null; order: ShopifyOrder },
): Promise<Received> {
  return sql.begin(async (tx) => {
    const fresh = await tx`
      INSERT INTO bridge.webhooks (webhook_id, event_id, topic, shop_domain)
      VALUES (${input.webhookId}, ${input.eventId}, ${input.topic}, ${input.shopDomain})
      ON CONFLICT (webhook_id) DO NOTHING
      RETURNING webhook_id`;
    if (fresh.length === 0) {
      const [seen] = await tx<{ order_id: number | null }[]>`
        SELECT order_id FROM bridge.webhooks WHERE webhook_id = ${input.webhookId}`;
      return { kind: "duplicate_webhook", orderId: seen?.order_id ?? null };
    }

    const inserted = await tx<{ id: number }[]>`
      INSERT INTO bridge.orders (shopify_order_id, name, payload)
      VALUES (${input.order.id}, ${input.order.name}, ${tx.json(input.order)})
      ON CONFLICT (shopify_order_id) DO NOTHING
      RETURNING id`;
    const orderId = inserted[0]?.id ??
      (await tx<{ id: number }[]>`SELECT id FROM bridge.orders WHERE shopify_order_id = ${input.order.id}`)[0].id;
    await tx`UPDATE bridge.webhooks SET order_id = ${orderId} WHERE webhook_id = ${input.webhookId}`;
    return inserted.length ? { kind: "new", orderId } : { kind: "duplicate_order", orderId };
  });
}
