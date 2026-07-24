import type { PurchaseProductRow } from "@/lib/data/inventory";
import type { PurchaseReturnProductRow } from "@/lib/data/purchase-returns";
import {
  getCatalogWarehouseStock,
  type ProductCatalogItem,
} from "@/lib/product-catalog";

export function catalogItemToPurchaseProduct(
  product: ProductCatalogItem,
): PurchaseProductRow {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    baseUnit: product.baseUnit,
    costPrice: product.costPrice ?? "0",
    totalStock: String(product.warehouseStock.reduce(
      (total, stock) => total + Number(stock.quantity),
      0,
    )),
    units: product.units.map((unit) => ({
      unitName: unit.unitName,
      multiplier: unit.multiplier,
    })),
  };
}

export function catalogItemToPurchaseReturnProduct(
  product: ProductCatalogItem,
  warehouseId: string,
): PurchaseReturnProductRow {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    baseUnit: product.baseUnit,
    costPrice: product.costPrice ?? "0",
    totalStock: String(getCatalogWarehouseStock(product, warehouseId)),
  };
}
