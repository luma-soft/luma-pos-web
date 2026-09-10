type PurchasePriceProduct = {
  lastPurchaseNetPrice?: string | number | null;
  prices?: Record<string, string | number | null>;
};

type PurchasePriceBook = {
  id: string;
  systemType?: string | null;
};

/** Latest net purchase price converted from the base unit to the sold unit. */
export function purchasePriceForSoldUnit(
  product: PurchasePriceProduct,
  priceBooks: readonly PurchasePriceBook[],
  unitMultiplier: number,
): number | null {
  const purchaseBook = priceBooks.find((book) => book.systemType === "purchase");
  const raw = purchaseBook
    ? product.prices?.[purchaseBook.id]
    : product.lastPurchaseNetPrice;
  if (raw == null || !Number.isFinite(unitMultiplier) || unitMultiplier <= 0) return null;
  const basePrice = Number(raw);
  if (!Number.isFinite(basePrice) || basePrice < 0) return null;
  return Number((basePrice * unitMultiplier).toFixed(2));
}

export function isSellPriceBelowPurchase(sellPrice: number, purchasePrice: number | null): boolean {
  return purchasePrice != null && Number.isFinite(sellPrice) && sellPrice < purchasePrice;
}
