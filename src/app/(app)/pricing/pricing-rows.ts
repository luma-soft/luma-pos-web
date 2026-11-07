import type { ProductCatalogItem } from "@/lib/product-catalog";
import type { PricingRow } from "./pricing-table";

/** Keep product identity metadata when projecting catalog entries into price rows. */
export function toPricingRow(product: ProductCatalogItem, books: { id: string }[], canViewPurchasePrices: boolean): PricingRow {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    variantName: product.variantName,
    specs: product.specs,
    baseUnit: product.baseUnit,
    units: product.units.map((unit) => ({
      unitName: unit.unitName,
      multiplier: Number(unit.multiplier),
      priceOverride: unit.priceOverride == null ? null : Number(unit.priceOverride),
    })),
    costPrice: canViewPurchasePrices && product.costPrice != null ? Number(product.costPrice) : null,
    lastPurchase: canViewPurchasePrices && product.lastPurchaseNetPrice != null ? Number(product.lastPurchaseNetPrice) : null,
    prices: Object.fromEntries(books.map((book) => {
      const value = product.prices[book.id];
      return [book.id, value == null ? null : Number(value)];
    })),
  };
}

/** Merge refreshed data without discarding edits or reordering the current list. */
export function reconcilePricingRows(
  current: PricingRow[],
  previous: PricingRow[],
  incoming: PricingRow[],
): PricingRow[] {
  const currentById = new Map(current.map((row) => [row.id, row]));
  const previousById = new Map(previous.map((row) => [row.id, row]));
  const reconciled = incoming.map((row) => {
    const local = currentById.get(row.id);
    const before = previousById.get(row.id);
    if (!local || !before) return row;
    const prices = { ...row.prices };
    for (const bookId of Object.keys(prices)) {
      if (local.prices[bookId] !== before.prices[bookId]) {
        prices[bookId] = local.prices[bookId];
      }
    }
    return { ...row, prices };
  });
  const reconciledById = new Map(reconciled.map((row) => [row.id, row]));

  const ordered: PricingRow[] = [];
  for (const row of current) {
    const refreshed = reconciledById.get(row.id);
    if (!refreshed) continue;
    ordered.push(refreshed);
    reconciledById.delete(row.id);
  }

  // Keep newly matching rows in the server's order after the rows already shown.
  return [...ordered, ...reconciledById.values()];
}
