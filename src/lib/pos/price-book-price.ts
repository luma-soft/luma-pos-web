import { systemPriceBookType, type PriceBookSource, type SystemPriceBookType } from "@/lib/pricing/system-price-books";

type PriceProduct = {
  retailPrice: string;
  prices?: Record<string, string | null>;
  priceBookTypes?: Record<string, SystemPriceBookType | null>;
};
type Book = PriceBookSource & { id: string };

export function posBasePrice(product: PriceProduct, bookId = "", books?: readonly Book[]): number | null {
  const book = books?.find((candidate) => candidate.id === bookId);
  if (bookId && books && !book) return null;
  const source = book ? systemPriceBookType(book) : product.priceBookTypes?.[bookId];
  const projected = bookId ? product.prices?.[bookId] : undefined;
  const value = source === "retail" ? product.retailPrice
    : source === "cost" || source === "purchase" || source === "list" ? projected
    : projected === null ? null : projected ?? product.retailPrice;
  if (value == null) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export function resolvePosBasePrice(product: PriceProduct, bookId = "", books?: readonly Book[]) {
  const book = books?.find((candidate) => candidate.id === bookId);
  if (bookId && books && !book) return null;
  const source = book ? systemPriceBookType(book) : product.priceBookTypes?.[bookId];
  const selectedPrice = posBasePrice(product, bookId, books);
  const hasCustomPrice = !bookId || source != null || product.prices?.[bookId] != null;
  if (selectedPrice != null && hasCustomPrice) return { price: selectedPrice, priceBookId: bookId };
  if (!bookId) return null;

  // Internal books represent cost inputs. Never replace missing cost data with a sell price.
  if (source === "cost" || source === "purchase" || book?.managerOnly) return null;

  const commonPrice = posBasePrice(product, "", books);
  return commonPrice == null ? null : { price: commonPrice, priceBookId: "" };
}

export function posUnitPrice(
  product: PriceProduct,
  unit: { multiplier: string; priceOverride: string | null } | null,
  bookId = "",
  books?: readonly Book[],
): number | null {
  const base = posBasePrice(product, bookId, books);
  if (base == null || !unit) return base;
  const book = books?.find((candidate) => candidate.id === bookId);
  const source = book ? systemPriceBookType(book) : product.priceBookTypes?.[bookId];
  if (source !== "cost" && source !== "purchase" && source !== "list" && unit.priceOverride != null) {
    const retail = Number(product.retailPrice);
    return Math.round(Number(unit.priceOverride) * (retail > 0 ? base / retail : 1));
  }
  return Math.round(base * Number(unit.multiplier));
}

export function resolvePosUnitPrice(
  product: PriceProduct,
  unit: { multiplier: string; priceOverride: string | null } | null,
  bookId = "",
  books?: readonly Book[],
) {
  const resolvedBase = resolvePosBasePrice(product, bookId, books);
  if (!resolvedBase) return null;
  const price = posUnitPrice(product, unit, resolvedBase.priceBookId, books);
  return price == null ? null : { price, priceBookId: resolvedBase.priceBookId };
}
