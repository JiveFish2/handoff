// npm run job -- <stock|reconcile> — runs a scheduled job once, now, through QStash.
import { Client } from "@upstash/qstash";

const job = process.argv[2];
if (!["stock", "reconcile", "sweep"].includes(job)) throw new Error("Usage: npm run job -- stock|reconcile|sweep");
const client = new Client({ token: process.env.QSTASH_TOKEN!, baseUrl: process.env.QSTASH_URL! });
await client.publishJSON({ url: `${process.env.PUBLIC_URL}/api/jobs/${job}`, body: {}, retries: 0 });
console.log(`${job} queued.`);
