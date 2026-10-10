import { connect } from "./postgres";

// One connection pool per server instance.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const sql = connect(url);
