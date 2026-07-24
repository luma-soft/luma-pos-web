import type { PosProduct } from "@/lib/data/pos";
import {
  getCatalogWarehouseStock,
  type ProductCatalogItem,
} from "@/lib/product-catalog";

export function catalogItemToPosProduct(
  product: ProductCatalogItem,
  catalog: readonly ProductCatalogItem[],
  warehouseId: string | null,
): PosProduct {
  const children = product.isVariantParent
    ? catalog.filter((candidate) => candidate.parentProductId === product.id)
    : [];
  const childPrices = children.map((child) => Number(child.retailPrice));
  const stock = product.isVariantParent
    ? children.reduce(
        (total, child) => total + (warehouseId ? getCatalogWarehouseStock(child, warehouseId) : 0),
        0,
      )
    : warehouseId
      ? getCatalogWarehouseStock(product, warehouseId)
      : 0;

  const mapChild = (child: ProductCatalogItem): PosProduct => ({
    ...catalogItemToPosProduct(child, [], warehouseId),
    children: [],
  });

  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    imageUrls: product.imageUrls,
    specs: product.specs,
    parentProductId: product.parentProductId,
    variantName: product.variantName,
    isVariantParent: product.isVariantParent,
    baseUnit: product.baseUnit,
    retailPrice: product.retailPrice,
    wholesalePrice: product.wholesalePrice,
    contractorPrice: product.contractorPrice,
    agentPrice: product.agentPrice,
    priceByWeight: product.priceByWeight,
    m2PerUnit: product.m2PerUnit,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    childCount: children.length,
    minRetailPrice: String(childPrices.length > 0 ? Math.min(...childPrices) : Number(product.retailPrice)),
    maxRetailPrice: String(childPrices.length > 0 ? Math.max(...childPrices) : Number(product.retailPrice)),
    stock: String(stock),
    units: product.units.map((unit) => ({
      unitName: unit.unitName,
      multiplier: unit.multiplier,
      priceOverride: unit.priceOverride,
    })),
    prices: product.prices,
    children: children.map(mapChild),
  };
}
