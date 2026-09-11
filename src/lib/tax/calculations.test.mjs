import { describe, expect, test } from "bun:test";
import { calculateTaxBreakdown } from "./calculations";

describe("calculateTaxBreakdown", () => {
  test("adds VAT when listed prices exclude tax", () => {
    expect(calculateTaxBreakdown({ lines: [{ total: 100_000, vatRate: null }], discount: 0, fallbackVatRate: 10, priceIncludesTax: false }))
      .toEqual({ taxableAmount: 100_000, tax: 10_000, totalAfterTax: 110_000, rates: [10] });
  });
  test("extracts VAT without increasing a tax-inclusive total", () => {
    expect(calculateTaxBreakdown({ lines: [{ total: 110_000, vatRate: null }], discount: 0, fallbackVatRate: 10, priceIncludesTax: true }))
      .toEqual({ taxableAmount: 100_000, tax: 10_000, totalAfterTax: 110_000, rates: [10] });
  });
  test("uses product VAT rates and allocates invoice discount proportionally", () => {
    expect(calculateTaxBreakdown({ lines: [{ total: 100_000, vatRate: 5 }, { total: 200_000, vatRate: 10 }, { total: 100_000, vatRate: null }], discount: 40_000, fallbackVatRate: 8, priceIncludesTax: false }))
      .toEqual({ taxableAmount: 360_000, tax: 29_700, totalAfterTax: 389_700, rates: [5, 8, 10] });
  });
  test("treats an explicit zero product rate as an override", () => {
    expect(calculateTaxBreakdown({ lines: [{ total: 100_000, vatRate: 0 }, { total: 100_000, vatRate: null }], discount: 0, fallbackVatRate: 10, priceIncludesTax: false }))
      .toEqual({ taxableAmount: 200_000, tax: 10_000, totalAfterTax: 210_000, rates: [0, 10] });
  });
  test("clamps an excessive discount and rejects invalid monetary inputs", () => {
    expect(calculateTaxBreakdown({ lines: [{ total: 50_000, vatRate: 10 }], discount: 80_000, fallbackVatRate: 8, priceIncludesTax: false }))
      .toEqual({ taxableAmount: 0, tax: 0, totalAfterTax: 0, rates: [10] });
    expect(() => calculateTaxBreakdown({ lines: [{ total: Number.NaN, vatRate: 10 }], discount: 0, fallbackVatRate: 8, priceIncludesTax: false }))
      .toThrow("Invalid tax line total");
  });
});
