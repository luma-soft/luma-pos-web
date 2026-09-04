export type SystemPriceBookType = "retail" | "cost" | "purchase";

export type PriceBookSource = {
  systemType?: SystemPriceBookType | null;
  isDefault?: boolean;
  costBased?: boolean;
  managerOnly?: boolean;
};

export function systemPriceBookType(book: PriceBookSource): SystemPriceBookType | null {
  return book.systemType ?? (book.isDefault ? "retail" : book.costBased ? "cost" : null);
}

export function isSystemPriceBook(book: PriceBookSource): boolean {
  return systemPriceBookType(book) !== null;
}

export function canViewPurchasePrices(role?: string): boolean {
  return role === "owner" || role === "manager";
}

export function isInternalPriceBook(book: PriceBookSource): boolean {
  const type = systemPriceBookType(book);
  return !!book.managerOnly || type === "cost" || type === "purchase";
}

export function resolvePriceBookPrice(
  book: PriceBookSource,
  product: { retailPrice: string | number; costPrice?: string | number | null; lastPurchasePrice?: string | number | null },
  override?: string | number | null,
): number | null {
  const type = systemPriceBookType(book);
  const value = type === "cost" ? product.costPrice
    : type === "purchase" ? product.lastPurchasePrice
      : type === "retail" ? product.retailPrice : override ?? product.retailPrice;
  if (value == null) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export const SYSTEM_PRICE_BOOK_NAMES: Record<SystemPriceBookType, string> = {
  retail: "Giá Chung",
  cost: "Giá vốn",
  purchase: "Giá Chưa Chiết Khấu",
};

export function isReservedPriceBookName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
  return Object.values(SYSTEM_PRICE_BOOK_NAMES).some((value) => value.toLocaleLowerCase("vi") === normalized);
}
