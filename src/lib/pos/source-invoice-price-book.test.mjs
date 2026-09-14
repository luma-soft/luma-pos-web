import { describe, expect, test } from "bun:test";
import { sourceInvoicePriceBookId } from "./source-invoice-price-book";

describe("source invoice price book", () => {
  test("uses the source invoice line price book", () => {
    expect(sourceInvoicePriceBookId([{ priceBookId: "wholesale" }])).toBe("wholesale");
  });

  test("uses the general price book when the source has no explicit book", () => {
    expect(sourceInvoicePriceBookId([{ priceBookId: null }])).toBeNull();
    expect(sourceInvoicePriceBookId([])).toBeNull();
  });
});
