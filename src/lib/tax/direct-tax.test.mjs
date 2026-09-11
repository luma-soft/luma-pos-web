import { describe, expect, test } from "bun:test";
import { applyDirectTaxPreset, DIRECT_TAX_PRESETS } from "./direct-tax.ts";

describe("direct tax presets", () => {
  test("adds the selected preset as an enabled activity", () => {
    const result = applyDirectTaxPreset([], DIRECT_TAX_PRESETS[0]);
    expect(result).toEqual([{ id: "direct-goods", name: "Phân phối, cung cấp hàng hóa", vatRate: 1, pitRate: 0.5, enabled: true }]);
  });

  test("updates an existing preset without duplicating it", () => {
    const result = applyDirectTaxPreset([{ id: "direct-goods", name: "Cũ", vatRate: 9, pitRate: 9, enabled: false }], DIRECT_TAX_PRESETS[0]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Phân phối, cung cấp hàng hóa", vatRate: 1, pitRate: 0.5, enabled: true });
  });
});
