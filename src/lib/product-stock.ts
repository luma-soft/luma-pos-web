import { formatNumber } from "@/lib/utils";

export const UNMANAGED_STOCK_CATEGORY_NAME = "dịch vụ";

type ProductStockSummary = {
  categoryName: string | null;
  productKind?: "product" | "service" | "combo";
  totalStock: number | string;
  baseUnit: string;
};

export function isProductStockManaged(
  categoryName: string | null,
  productKind: ProductStockSummary["productKind"] = "product",
) {
  if (productKind !== "product") return false;
  return (
    categoryName?.normalize("NFC").trim().toLocaleLowerCase("vi")
    !== UNMANAGED_STOCK_CATEGORY_NAME
  );
}

export function productStockQuantityDisplay(
  product: ProductStockSummary,
): string | null {
  if (!isProductStockManaged(product.categoryName, product.productKind)) return null;
  return `${formatNumber(product.totalStock)} ${product.baseUnit}`;
}

export function productStockDisplay(
  product: ProductStockSummary,
  notTrackedLabel: string,
) {
  return productStockQuantityDisplay(product) ?? notTrackedLabel;
}
