import { START_STOCK, variants } from "@/catalog";
import type { Sql } from "@/lib/postgres";

// The demo's nightly reset, before the reconciliation: every fault off, every ERP item back
// to its starting stock (booked as an adjustment, so the next stock sync carries it to the
// store), and the demo's action log trimmed. Orders and their trails are kept.
export async function resetDemo(sql: Sql) {
  return sql.begin(async (tx) => {
    await tx`DELETE FROM erp.faults`;
    let adjusted = 0;
    for (const v of variants()) {
      const target = START_STOCK[v.size];
      const [item] = await tx<{ stock: number }[]>`SELECT stock FROM erp.items WHERE code = ${v.erpCode} FOR UPDATE`;
      if (!item || item.stock === target) continue;
      await tx`UPDATE erp.items SET stock = ${target} WHERE code = ${v.erpCode}`;
      await tx`INSERT INTO erp.stock_adjustments (item_code, delta, reason)
        VALUES (${v.erpCode}, ${target - item.stock}, 'Nightly demo reset')`;
      adjusted++;
    }
    await tx`DELETE FROM bridge.demo_actions WHERE at < now() - interval '2 days'`;
    return { adjusted };
  });
}
