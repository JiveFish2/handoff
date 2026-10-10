import { describe, expect, it } from "vitest";
import { toErpLines, UnmappedSkuError } from "@/lib/bridge/mapping";
import { sampleOrder } from "./helpers";

const map = new Map([["first-light-250", "KH-ETH-250"], ["long-table-1kg", "KH-COL-1000"]]);

describe("toErpLines", () => {
  it("translates SKUs to ERP codes and keeps quantity and price", () => {
    const order = sampleOrder([{ sku: "first-light-250", quantity: 2 }, { sku: "long-table-1kg" }]);
    expect(toErpLines(order.line_items, map)).toEqual([
      { item_code: "KH-ETH-250", quantity: 2, unit_price: "19.00", note: null },
      { item_code: "KH-COL-1000", quantity: 1, unit_price: "19.00", note: null },
    ]);
  });

  it("turns the grind property into a line note", () => {
    const order = sampleOrder([{ sku: "first-light-250", grind: "Espresso" }]);
    expect(toErpLines(order.line_items, map)[0].note).toBe("Grind: Espresso");
  });

  it("refuses an order with an unmapped or missing SKU", () => {
    expect(() => toErpLines(sampleOrder([{ sku: "gift-card-25" }]).line_items, map)).toThrow(UnmappedSkuError);
    expect(() => toErpLines(sampleOrder([{ sku: null }]).line_items, map)).toThrow(UnmappedSkuError);
  });
});
