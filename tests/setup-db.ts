import { migrate } from "../src/lib/migrate";
import { connect } from "../src/lib/postgres";

// Rebuilds the test database from the migrations before every run.
export default async function setup() {
  const sql = connect(process.env.TEST_DATABASE_URL ?? "postgresql://handoff:handoff@127.0.0.1:5434/handoff_test", 1);
  await sql`DROP SCHEMA IF EXISTS bridge CASCADE`;
  await sql`DROP SCHEMA IF EXISTS erp CASCADE`;
  await sql`DROP TABLE IF EXISTS public.schema_migrations`;
  await migrate(sql);
  await sql.end();
}
