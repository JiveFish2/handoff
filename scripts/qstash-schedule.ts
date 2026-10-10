// npm run qstash:schedule — creates (or moves) the bridge's schedules at PUBLIC_URL:
//   sweep      every 15 minutes   re-queues orders the queue lost
//   stock      every 15 minutes   catches ERP stock moves that no order triggered
//   reconcile  07:00 UTC daily    the nightly check (3 a.m. in New York)
// Run again whenever PUBLIC_URL changes.
import { Client } from "@upstash/qstash";

const client = new Client({ token: process.env.QSTASH_TOKEN!, baseUrl: process.env.QSTASH_URL! });
const SCHEDULES = [
  { path: "/api/jobs/sweep", cron: "*/15 * * * *" },
  { path: "/api/jobs/stock", cron: "7,22,37,52 * * * *" },
  { path: "/api/jobs/reconcile", cron: "0 7 * * *" },
];

const existing = await client.schedules.list();
for (const { path, cron } of SCHEDULES) {
  for (const schedule of existing.filter((s) => s.destination.endsWith(path))) {
    await client.schedules.delete(schedule.scheduleId);
    console.log(`Removed ${schedule.destination}`);
  }
  const destination = `${process.env.PUBLIC_URL}${path}`;
  await client.schedules.create({ destination, cron, retries: path.endsWith("reconcile") ? 3 : 0 });
  console.log(`${cron.padEnd(18)} → ${destination}`);
}
