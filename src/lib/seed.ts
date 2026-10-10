import { START_STOCK, variants } from "@/catalog";
import type { Sql } from "./postgres";

// Loads the catalog into both sides: ERP items with their starting stock, and the SKU map the
// bridge uses to translate between them. Safe to run again; it resets stock to the start.
export async function seed(sql: Sql) {
  for (const v of variants()) {
    const stock = START_STOCK[v.size];
    await sql`INSERT INTO erp.items (code, name, stock) VALUES (${v.erpCode}, ${v.title}, ${stock})
      ON CONFLICT (code) DO UPDATE SET name = excluded.name, stock = excluded.stock`;
    await sql`INSERT INTO bridge.sku_map (shopify_sku, erp_code) VALUES (${v.shopifySku}, ${v.erpCode})
      ON CONFLICT (shopify_sku) DO UPDATE SET erp_code = excluded.erp_code`;
  }
}
