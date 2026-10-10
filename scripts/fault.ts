// npm run fault -- <down|slow|rate_limited|response_lost|rejects|off> [minutes]
// Switches one of the ERP's failure modes on for a while (3 minutes by default), or all off.
import { connect } from "../src/lib/postgres";

const [mode, minutes = "3"] = process.argv.slice(2);
const sql = connect(process.env.DATABASE_URL!, 1);
if (mode === "off") {
  await sql`DELETE FROM erp.faults`;
  console.log("All faults off.");
} else {
  await sql`INSERT INTO erp.faults (mode, until) VALUES (${mode}, now() + ${Number(minutes) * 60} * interval '1 second')
    ON CONFLICT (mode) DO UPDATE SET until = excluded.until`;
  console.log(`${mode} on for ${minutes} min.`);
}
await sql.end();
