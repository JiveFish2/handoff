import { after } from "next/server";
import { sql } from "@/lib/db";
import { enqueue } from "@/lib/bridge/enqueue";
import { receiveOrder } from "@/lib/bridge/receive";
import { queue, shopifySecret } from "@/lib/services";
import { verifyWebhook } from "@/lib/shopify/hmac";
import { parseOrder } from "@/lib/shopify/order";

// Shopify expects a quick 200. The order is stored first and handed to the queue after the
// answer has gone out, so a slow ERP never makes Shopify think the webhook failed. If the
// queue cannot be reached, the order waits in `received` and the sweep queues it later.
export async function POST(request: Request) {
  const body = await request.text();
  if (!verifyWebhook(body, request.headers.get("x-shopify-hmac-sha256"), shopifySecret())) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic");
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (topic !== "orders/create") return Response.json({ ignored: topic });
  if (!webhookId) return Response.json({ error: "missing_webhook_id" }, { status: 400 });

  let order;
  try {
    order = parseOrder(JSON.parse(body));
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const received = await receiveOrder(sql, {
    webhookId,
    eventId: request.headers.get("x-shopify-event-id"),
    topic,
    shopDomain: request.headers.get("x-shopify-shop-domain"),
    order,
  });
  if (received.kind === "new") {
    after(() =>
      enqueue(sql, queue(), received.orderId).catch((error) =>
        console.error(`Order ${received.orderId} not queued; the sweep will retry`, error),
      ),
    );
  }
  return Response.json({ received: received.kind });
}
