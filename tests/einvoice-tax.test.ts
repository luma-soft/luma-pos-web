import { describe, expect, test } from "bun:test";
import { deriveEInvoiceFallbackVatRate } from "../src/lib/einvoice/tax";

describe("e-invoice fallback VAT", () => {
  test("derives a finite rate from authoritative order totals", () => {
    expect(deriveEInvoiceFallbackVatRate({
      subtotal: 1_000_000,
      discount: 0,
      tax: 80_000,
    })).toBe(8);
  });

  test("clamps provider-compatible fallback and rejects invalid bases", () => {
    expect(deriveEInvoiceFallbackVatRate({
      subtotal: 1_000_000,
      discount: 100_000,
      tax: 500_000,
    })).toBe(20);
    expect(deriveEInvoiceFallbackVatRate({
      subtotal: 0,
      discount: 0,
      tax: 80_000,
    })).toBe(0);
  });
});
