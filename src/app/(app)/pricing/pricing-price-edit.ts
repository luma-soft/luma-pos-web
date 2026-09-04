import { buildUnitPriceReview, type UnitPriceBook, type UnitPriceChoice, type UnitPricingSnapshot } from "@/lib/products/unit-price-edit";
import { isPriceBookReadOnly, systemPriceBookType } from "@/lib/pricing/system-price-books";
import { planPriceEdit, priceEditSnapshot, priceMoney, pricingUnitPrice, pricingUnitScale, type PriceEditProduct } from "@/lib/pricing/price-edit";
import type { PricingBook, PricingRow } from "./pricing-table";

function pricingProduct(row: PricingRow, retailId: string): PriceEditProduct {
  return { baseUnit: row.baseUnit, retailPrice: row.prices[retailId] ?? 0,
    units: (row.units ?? []).map((unit) => ({ ...unit, priceOverride: unit.priceOverride ?? null })) };
}

export function canEditPricingUnit(row: PricingRow, book: PricingBook, retailId: string, unitName: string): boolean {
  if (isPriceBookReadOnly(book)) return false;
  if (unitName === row.baseUnit) return true;
  const product = pricingProduct(row, retailId);
  const unit = product.units.find((candidate) => candidate.unitName === unitName);
  if (!unit || !Number.isFinite(unit.multiplier) || unit.multiplier <= 0) return false;
  const scale = pricingUnitScale(product, book, unit);
  return scale != null && Number.isFinite(scale) && scale > 0;
}

export function pricingUnitValue(row: PricingRow, book: PricingBook, retailId: string, unitName: string) {
  return pricingUnitPrice(pricingProduct(row, retailId), book, row.prices[book.id] ?? null, unitName);
}

/** Use the raw acknowledged row for both the preview and optimistic concurrency. */
export function preparePricingPriceEdit(row: PricingRow, books: PricingBook[], bookId: string, value: number | null, unitName = row.baseUnit, forceConfirmation = false) {
  const book = books.find((candidate) => candidate.id === bookId);
  if (!book || isPriceBookReadOnly(book)) return null;
  const retailId = books.find((candidate) => candidate.isDefault)?.id ?? books[0]?.id ?? "";
  if (!canEditPricingUnit(row, book, retailId, unitName)) return null;
  const product = pricingProduct(row, retailId);
  const currentBasePrice = row.prices[bookId] ?? null;
  const price = value == null ? null : priceMoney(value);
  const plan = planPriceEdit(product, book, currentBasePrice, price, unitName, "keep");
  if (plan.basePrice === currentBasePrice && plan.units.every((unit, index) => unit.priceOverride === product.units[index].priceOverride)) return null;
  const reviewBooks: UnitPriceBook[] = books.filter((candidate) => !candidate.isDefault && !isPriceBookReadOnly(candidate))
    .map((candidate) => ({ key: candidate.id, label: candidate.name, kind: systemPriceBookType(candidate) === "list" ? "list" : "custom" }));
  const before: UnitPricingSnapshot = {
    ...product, costPrice: row.costPrice ?? undefined,
    units: product.units.filter((unit) => unit.unitName !== row.baseUnit),
    priceBookPrices: Object.fromEntries(reviewBooks.map(({ key }) => [key, row.prices[key] ?? null])),
  };
  const draft: UnitPricingSnapshot = { ...before, units: plan.units.filter((unit) => unit.unitName !== row.baseUnit),
    ...(book.isDefault ? { retailPrice: plan.basePrice! }
      : { priceBookPrices: { ...before.priceBookPrices, [bookId]: plan.basePrice } }) };
  return { row, book, bookId, retailId, product, price, unitName, before, draft, books: reviewBooks,
    expected: priceEditSnapshot(product, currentBasePrice),
    required: forceConfirmation || buildUnitPriceReview(before, draft, reviewBooks).required };
}

export type PricingPriceEdit = NonNullable<ReturnType<typeof preparePricingPriceEdit>>;

/** Return the exact same plan for the popup, submitted unit/source and saved row. */
export function resolvePricingPriceEdit(edit: PricingPriceEdit, mode: UnitPriceChoice = "keep", source: string | null = "base") {
  let price = edit.price, unitName = edit.unitName;
  if (mode === "sync") {
    if (!edit.book.isDefault) throw new Error("errors.invalidData");
    if (source === "base") { price = edit.draft.retailPrice; unitName = edit.row.baseUnit; }
    else {
      const unit = edit.draft.units.find((candidate) => `unit:${candidate.id ?? candidate.unitName}` === source);
      if (!unit || unit.priceOverride == null) throw new Error("errors.invalidData");
      price = unit.priceOverride; unitName = unit.unitName;
    }
  }
  const plan = planPriceEdit(edit.product, edit.book, edit.row.prices[edit.bookId] ?? null, price, unitName, mode);
  const draft: UnitPricingSnapshot = { ...edit.before, units: plan.units.filter((unit) => unit.unitName !== edit.row.baseUnit),
    ...(edit.book.isDefault ? { retailPrice: plan.basePrice! }
      : { priceBookPrices: { ...edit.before.priceBookPrices, [edit.bookId]: plan.basePrice } }) };
  return { draft,
    row: { ...edit.row, units: plan.units, prices: { ...edit.row.prices, [edit.bookId]: plan.basePrice } },
    payload: { priceBookId: edit.bookId, productId: edit.row.id, price, unitName, unitPriceMode: mode, expected: edit.expected },
  };
}
