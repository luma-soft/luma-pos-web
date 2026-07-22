import { formatNumber } from "@/lib/utils";

type ProductStockSummary = {
  categoryName: string | null;
  totalStock: number | string;
  baseUnit: string;
};

export function isProductStockManaged(categoryName: string | null) {
  return categoryName?.normalize("NFC").trim().toLowerCase() !== "dịch vụ";
}

export function productStockDisplay(
  product: ProductStockSummary,
  notTrackedLabel: string,
) {
  if (!isProductStockManaged(product.categoryName)) return notTrackedLabel;
  return `${formatNumber(product.totalStock)} ${product.baseUnit}`;
}
