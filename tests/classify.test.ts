import { describe, expect, it } from "vitest";
import { classify } from "@/lib/bridge/classify";
import { UnmappedSkuError } from "@/lib/bridge/mapping";
import { ErpError } from "@/lib/erp/client";

describe("classify", () => {
  it.each([null, 408, 429, 500, 502, 503, 504])("treats %s from the ERP as transient", (status) => {
    expect(classify(new ErpError("x", status))).toBe("transient");
  });

  it.each([400, 401, 403, 404, 422])("treats %s from the ERP as permanent", (status) => {
    expect(classify(new ErpError("x", status))).toBe("permanent");
  });

  it("treats an unmapped SKU as permanent", () => {
    expect(classify(new UnmappedSkuError("gift-card-25", "Gift card"))).toBe("permanent");
  });

  it("treats anything unexpected as transient", () => {
    expect(classify(new Error("connection reset"))).toBe("transient");
  });
});
