export const PRODUCT_SORTS = [
  "recent_sales",
  "updated",
  "name",
  "sku",
  "cost",
  "retail",
  "stock",
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const DEFAULT_PRODUCT_SORT: ProductSort = "recent_sales";

export function parseProductSort(value: unknown, fallback: ProductSort = DEFAULT_PRODUCT_SORT): ProductSort {
  return PRODUCT_SORTS.includes(value as ProductSort) ? value as ProductSort : fallback;
}

export type SortableProduct = {
  id: string;
  name: string;
  sku?: string | null;
  updatedAt?: string | Date;
  lastSoldAt?: string | Date | null;
  costPrice?: string | number | null;
  retailPrice?: string | number | null;
  stock?: string | number | null;
  totalStock?: string | number | null;
  warehouseStock?: readonly { quantity: string | number }[];
};

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function stockValue(product: SortableProduct): number {
  if (product.totalStock != null) return numberValue(product.totalStock);
  if (product.stock != null) return numberValue(product.stock);
  return product.warehouseStock?.reduce((total, stock) => total + numberValue(stock.quantity), 0) ?? 0;
}

export function compareProductsBySort(left: SortableProduct, right: SortableProduct, sort: ProductSort): number {
  let primary = 0;
  switch (sort) {
    case "recent_sales":
      primary = dateValue(right.lastSoldAt) - dateValue(left.lastSoldAt);
      break;
    case "updated":
      primary = dateValue(right.updatedAt) - dateValue(left.updatedAt);
      break;
    case "sku":
      primary = (left.sku ?? "").localeCompare(right.sku ?? "", "vi");
      break;
    case "cost":
      primary = numberValue(right.costPrice) - numberValue(left.costPrice);
      break;
    case "retail":
      primary = numberValue(right.retailPrice) - numberValue(left.retailPrice);
      break;
    case "stock":
      primary = stockValue(left) - stockValue(right);
      break;
    case "name":
    default:
      primary = left.name.localeCompare(right.name, "vi");
      break;
  }
  return primary || left.name.localeCompare(right.name, "vi") || left.id.localeCompare(right.id);
}

export function sortProductsBySort<T extends SortableProduct>(products: readonly T[], sort: ProductSort): T[] {
  return [...products].sort((left, right) => compareProductsBySort(left, right, sort));
}

export function productSortPreferenceCookieName(storeId: string): string {
  const safeStoreId = storeId.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return `luma-product-sort-${safeStoreId}`;
}

export function writeProductSortPreferenceCookie(storeId: string, sort: ProductSort): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${productSortPreferenceCookieName(storeId)}=${sort}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
