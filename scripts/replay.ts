// npm run replay -- <order name or id> — sends an order from the failed queue back to the ERP.
import { replayOrder } from "../src/lib/bridge/replay";
import { connect } from "../src/lib/postgres";
import { qstashQueue } from "../src/lib/queue";

const arg = process.argv[2];
if (!arg) throw new Error("Usage: npm run replay -- <#1001 or order id>");
const sql = connect(process.env.DATABASE_URL!, 1);
const queue = qstashQueue({ token: process.env.QSTASH_TOKEN!, baseUrl: process.env.QSTASH_URL!, publicUrl: process.env.PUBLIC_URL! });

const [order] = await sql<{ id: number; name: string; status: string }[]>`
  SELECT id, name, status FROM bridge.orders WHERE name = ${arg} OR id::text = ${arg}`;
if (!order) console.log(`No order ${arg}.`);
else if (await replayOrder(sql, queue, order.id)) console.log(`${order.name} sent back for delivery.`);
else console.log(`${order.name} is ${order.status}; only failed orders can be replayed.`);
await sql.end();
