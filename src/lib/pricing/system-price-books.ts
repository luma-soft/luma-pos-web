export type SystemPriceBookType = "retail" | "cost" | "purchase" | "list";

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

/** System metadata is fixed; only receipt/cost-derived prices are read-only. */
export function isPriceBookReadOnly(book: PriceBookSource): boolean {
  const type = systemPriceBookType(book);
  return type === "cost" || type === "purchase";
}

export function comparePriceBooks(
  a: PriceBookSource & { sortOrder?: number; name?: string },
  b: PriceBookSource & { sortOrder?: number; name?: string },
): number {
  const order: Record<SystemPriceBookType, number> = { cost: 0, purchase: 1, list: 2, retail: 3 };
  const aType = systemPriceBookType(a), bType = systemPriceBookType(b);
  return (aType ? order[aType] : 4) - (bType ? order[bType] : 4)
    || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || (a.name ?? "").localeCompare(b.name ?? "", "vi");
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
  product: { retailPrice: string | number; costPrice?: string | number | null; lastPurchasePrice?: string | number | null; lastPurchaseNetPrice?: string | number | null },
  override?: string | number | null,
): number | null {
  const type = systemPriceBookType(book);
  const value = type === "cost" ? product.costPrice
    : type === "purchase" ? product.lastPurchaseNetPrice
      : type === "list" ? override
        : type === "retail" ? product.retailPrice : override ?? product.retailPrice;
  if (value == null) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export const SYSTEM_PRICE_BOOK_NAMES: Record<SystemPriceBookType, string> = {
  retail: "Giá chung",
  cost: "Giá vốn",
  purchase: "Giá nhập cuối",
  list: "Giá chưa chiết khấu",
};

export function isReservedPriceBookName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
  return Object.values(SYSTEM_PRICE_BOOK_NAMES).some((value) => value.toLocaleLowerCase("vi") === normalized);
}
