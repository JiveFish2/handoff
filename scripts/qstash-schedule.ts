// npm run qstash:schedule — creates (or moves) the schedule that calls the sweep every
// 15 minutes at PUBLIC_URL. Run again whenever PUBLIC_URL changes.
import { Client } from "@upstash/qstash";

const client = new Client({ token: process.env.QSTASH_TOKEN!, baseUrl: process.env.QSTASH_URL! });
const destination = `${process.env.PUBLIC_URL}/api/jobs/sweep`;

for (const schedule of await client.schedules.list()) {
  if (schedule.destination.endsWith("/api/jobs/sweep")) {
    await client.schedules.delete(schedule.scheduleId);
    console.log(`Removed ${schedule.destination}`);
  }
}
await client.schedules.create({ destination, cron: "*/15 * * * *", retries: 0 });
console.log(`Sweep scheduled every 15 minutes → ${destination}`);
