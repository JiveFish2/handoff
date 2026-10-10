// npm run db:migrate — applies pending migrations to DATABASE_URL.
import { connect } from "../src/lib/postgres";
import { migrate } from "../src/lib/migrate";

const sql = connect(process.env.DATABASE_URL!, 1);
const applied = await migrate(sql);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Nothing to apply.");
await sql.end();
