// npm run db:seed — loads the Kilnhouse catalog into the ERP and the SKU map.
import { connect } from "../src/lib/postgres";
import { seed } from "../src/lib/seed";

const sql = connect(process.env.DATABASE_URL!, 1);
await seed(sql);
console.log("Catalog loaded.");
await sql.end();
