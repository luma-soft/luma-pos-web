import { describe, expect, it } from "vitest";
import { calculateProductTax } from "@/lib/orders/product-tax";

describe("per-product VAT", () => {
  it("uses explicit product rates and allocates order discount proportionally", () => {
    expect(calculateProductTax({
      lines: [
        { total: 100_000, vatRate: 10 },
        { total: 100_000, vatRate: 0 },
      ],
      discount: 20_000,
      fallbackVatRate: 8,
    })).toBe(9_000);
  });

  it("falls back to order VAT only for legacy products without an override", () => {
    expect(calculateProductTax({
      lines: [{ total: 100_000, vatRate: null }],
      discount: 0,
      fallbackVatRate: 8,
    })).toBe(8_000);
  });
});
