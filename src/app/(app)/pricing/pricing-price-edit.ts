import { buildUnitPriceReview, normalizeUnitPriceDraft, type UnitPriceBook, type UnitPricingSnapshot } from "@/lib/products/unit-price-edit";
import { isPriceBookReadOnly, systemPriceBookType } from "@/lib/pricing/system-price-books";
import type { PricingBook, PricingRow } from "./pricing-table";

/** Compare against acknowledged prices, never the already-edited input value. */
export function preparePricingPriceEdit(row: PricingRow, books: PricingBook[], bookId: string, value: number | null) {
  const book = books.find((candidate) => candidate.id === bookId);
  if (!book || isPriceBookReadOnly(book)) return null;
  const retailId = books.find((candidate) => candidate.isDefault)?.id ?? books[0]?.id ?? "";
  const reviewBooks: UnitPriceBook[] = books.filter((candidate) => !candidate.isDefault && !isPriceBookReadOnly(candidate))
    .map((candidate) => ({ key: candidate.id, label: candidate.name, kind: systemPriceBookType(candidate) === "list" ? "list" : "custom" }));
  const before = normalizeUnitPriceDraft<UnitPricingSnapshot>({
    baseUnit: row.baseUnit, retailPrice: row.prices[retailId] ?? 0,
    units: row.units ?? [],
    priceBookPrices: Object.fromEntries(reviewBooks.map(({ key }) => [key, row.prices[key] ?? null])),
  });
  const draft = normalizeUnitPriceDraft({
    ...before,
    ...(book.isDefault ? { retailPrice: Math.max(0, value ?? 0) }
      : { priceBookPrices: { ...before.priceBookPrices, [bookId]: value == null ? null : Math.max(0, value) } }),
  });
  const price = book.isDefault ? draft.retailPrice : draft.priceBookPrices?.[bookId] ?? null;
  if (price === (row.prices[bookId] ?? null)) return null;
  return { row, bookId, price, before, draft, books: reviewBooks, required: buildUnitPriceReview(before, draft, reviewBooks).required };
}
