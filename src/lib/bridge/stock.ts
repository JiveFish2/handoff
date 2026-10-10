import type { ErpClient } from "@/lib/erp/client";
import type { Sql } from "@/lib/postgres";
import type { ShopifyOrder } from "@/lib/shopify/order";
import type { Store, StoreLevel } from "@/lib/shopify/store";

// Stock flows one way: the ERP is the source of truth and the store gets absolute numbers.
//
// One correction: orders the store has sold but the ERP has not booked yet (still queued,
// retrying, or in the failed queue). The ERP's number does not include them, so pushing it
// as it is would hand those units back to the store and let it sell them twice. The bridge
// subtracts them first. An order whose try is under way may already be booked; counting it
// anyway can only make the store show a little less for a moment, never more.

export async function pendingByCode(sql: Sql): Promise<Map<string, number>> {
  const [orders, map] = await Promise.all([
    sql<{ payload: ShopifyOrder }[]>`
      SELECT payload FROM bridge.orders WHERE status IN ('received', 'delivering', 'retrying', 'failed')`,
    sql<{ shopify_sku: string; erp_code: string }[]>`SELECT shopify_sku, erp_code FROM bridge.sku_map`,
  ]);
  const codeBySku = new Map(map.map((m) => [m.shopify_sku, m.erp_code]));
  const pending = new Map<string, number>();
  for (const { payload } of orders) {
    for (const line of payload.line_items) {
      const code = line.sku ? codeBySku.get(line.sku) : undefined;
      if (code) pending.set(code, (pending.get(code) ?? 0) + line.quantity);
    }
  }
  return pending;
}

export const available = (erpStock: number, pending: number) => Math.max(0, erpStock - pending);

type Mapped = { sku: string; erpCode: string; inventoryItemId: string | null };

// The SKU map, with the store's inventory item IDs filled in the first time they are needed.
async function mapping(sql: Sql, store: Store, levels?: StoreLevel[]): Promise<Mapped[]> {
  let rows = await sql<{ shopify_sku: string; erp_code: string; inventory_item_id: string | null }[]>`
    SELECT shopify_sku, erp_code, inventory_item_id FROM bridge.sku_map`;
  if (rows.some((r) => !r.inventory_item_id)) {
    for (const level of levels ?? (await store.levels())) {
      await sql`UPDATE bridge.sku_map SET inventory_item_id = ${level.inventoryItemId}
        WHERE shopify_sku = ${level.sku} AND inventory_item_id IS NULL`;
    }
    rows = await sql`SELECT shopify_sku, erp_code, inventory_item_id FROM bridge.sku_map`;
  }
  return rows.map((r) => ({ sku: r.shopify_sku, erpCode: r.erp_code, inventoryItemId: r.inventory_item_id }));
}

const CURSOR = "stock_cursor";

// Pushes every item whose ERP stock changed since the last run. The cursor only moves after
// the store accepted the new numbers, so a failed push is simply repeated next time.
export async function syncStock(sql: Sql, erp: ErpClient, store: Store): Promise<{ sku: string; quantity: number }[]> {
  const [state] = await sql<{ value: string }[]>`SELECT value FROM bridge.state WHERE key = ${CURSOR}`;
  const changed = await erp.stockSince(Number(state?.value ?? 0));
  if (changed.items.length === 0) return [];

  const [pending, mapped] = await Promise.all([pendingByCode(sql), mapping(sql, store)]);
  const byCode = new Map(mapped.map((m) => [m.erpCode, m]));
  const pushes = changed.items.flatMap((item) => {
    const m = byCode.get(item.code);
    if (!m?.inventoryItemId) return []; // an ERP item the store does not sell
    return [{ sku: m.sku, inventoryItemId: m.inventoryItemId, quantity: available(item.stock, pending.get(item.code) ?? 0) }];
  });

  await store.setAvailable(pushes, `handoff://stock-sync/${changed.cursor}`);
  await sql.begin(async (tx) => {
    for (const p of pushes) {
      await tx`INSERT INTO bridge.stock_pushes (sku, quantity, source) VALUES (${p.sku}, ${p.quantity}, 'sync')`;
    }
    // GREATEST: two syncs running at once must never move the cursor backwards.
    await tx`INSERT INTO bridge.state (key, value) VALUES (${CURSOR}, ${String(changed.cursor)})
      ON CONFLICT (key) DO UPDATE SET value = GREATEST(bridge.state.value::bigint, excluded.value::bigint)::text,
        updated_at = now()`;
  });
  return pushes.map(({ sku, quantity }) => ({ sku, quantity }));
}

// Compares every variant's store quantity with what it should be, and corrects the ones that
// drifted. Used by the nightly reconciliation.
export async function reconcileStock(sql: Sql, erp: ErpClient, store: Store) {
  const [all, pending, levels] = await Promise.all([erp.stockSince(0), pendingByCode(sql), store.levels()]);
  const mapped = await mapping(sql, store, levels);
  const stockByCode = new Map(all.items.map((i) => [i.code, i.stock]));
  const levelBySku = new Map(levels.map((l) => [l.sku, l]));

  const fixes: { sku: string; inventoryItemId: string; store: number; expected: number }[] = [];
  let checked = 0;
  for (const m of mapped) {
    const level = levelBySku.get(m.sku);
    const stock = stockByCode.get(m.erpCode);
    if (!level || stock === undefined) continue;
    checked++;
    const expected = available(stock, pending.get(m.erpCode) ?? 0);
    if (level.available !== expected) fixes.push({ sku: m.sku, inventoryItemId: level.inventoryItemId, store: level.available, expected });
  }

  await store.setAvailable(fixes.map((f) => ({ inventoryItemId: f.inventoryItemId, quantity: f.expected })), "handoff://reconcile");
  for (const f of fixes) {
    await sql`INSERT INTO bridge.stock_pushes (sku, quantity, previous, source) VALUES (${f.sku}, ${f.expected}, ${f.store}, 'reconcile')`;
  }
  return { checked, fixes: fixes.map(({ sku, store, expected }) => ({ sku, store, expected })) };
}
