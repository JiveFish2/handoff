import { Client } from "@upstash/qstash";

// The queue that carries deliveries to the ERP. QStash calls back /api/jobs/deliver with the
// order ID and, while the answer is not a 2xx, calls again with a growing delay.

// Six retries after the first try, waiting 10 s, 20 s, 40 s, 80 s, 160 s and 300 s: about ten
// minutes in all, longer than any fault in the demo stays on.
export const MAX_RETRIES = 6;
export const RETRY_DELAY = "min(300000, pow(2, retried) * 10000)";

export type Queue = { enqueueDelivery(orderId: number): Promise<void> };

export function qstashQueue({ token, baseUrl, publicUrl }: { token: string; baseUrl: string; publicUrl: string }): Queue {
  const client = new Client({ token, baseUrl });
  return {
    async enqueueDelivery(orderId) {
      await client.publishJSON({
        url: `${publicUrl}/api/jobs/deliver`,
        body: { orderId },
        retries: MAX_RETRIES,
        retryDelay: RETRY_DELAY,
      });
    },
  };
}
