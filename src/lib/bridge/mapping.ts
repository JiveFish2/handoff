import type { ShopifyLineItem } from "@/lib/shopify/order";

export type ErpLine = { item_code: string; quantity: number; unit_price: string; note: string | null };

// A line the ERP cannot be sent: retrying will not help until someone fixes the mapping.
export class UnmappedSkuError extends Error {
  constructor(readonly sku: string | null, readonly title: string) {
    super(sku ? `No ERP item for SKU ${sku}` : `Line "${title}" has no SKU`);
  }
}

// Translates the store's lines into the ERP's: SKU to item code, and the chosen grind (a
// line-item property in the store) into the line note the warehouse reads.
export function toErpLines(items: ShopifyLineItem[], skuMap: ReadonlyMap<string, string>): ErpLine[] {
  return items.map((item) => {
    const code = item.sku ? skuMap.get(item.sku) : undefined;
    if (!code) throw new UnmappedSkuError(item.sku, item.title);
    const grind = item.properties?.find((p) => p.name.toLowerCase() === "grind")?.value;
    return { item_code: code, quantity: item.quantity, unit_price: item.price, note: grind ? `Grind: ${grind}` : null };
  });
}
