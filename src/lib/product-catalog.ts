import { normalizeSearch } from "@/lib/normalize";

export const PRODUCT_CATALOG_SCHEMA_VERSION = 1;

export type CatalogUnit = {
  unitName: string;
  multiplier: string;
  barcode: string | null;
  priceOverride: string | null;
};

export type CatalogWarehouseStock = {
  warehouseId: string;
  quantity: string;
  reserved: string;
  minLevel: string;
};

export type ProductCatalogItem = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  brandName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  baseUnit: string;
  costPrice: string | null;
  retailPrice: string;
  wholesalePrice: string | null;
  contractorPrice: string | null;
  agentPrice: string | null;
  imageUrls: string[] | null;
  specs: unknown;
  parentProductId: string | null;
  variantName: string | null;
  isVariantParent: boolean;
  m2PerUnit: string | null;
  priceByWeight: boolean;
  isStockManaged: boolean;
  units: CatalogUnit[];
  prices: Record<string, string>;
  warehouseStock: CatalogWarehouseStock[];
  updatedAt: string;
};

export type ProductCatalogWarehouse = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type ProductCatalogSnapshot = {
  schemaVersion: typeof PRODUCT_CATALOG_SCHEMA_VERSION;
  userId: string;
  scopeId: string;
  savedAt: number;
  products: ProductCatalogItem[];
  warehouses: ProductCatalogWarehouse[];
};

export type ProductCatalogSearchOptions = {
  stockManagedOnly?: boolean;
  excludeIds?: ReadonlySet<string>;
  limit?: number;
};

export function searchProductCatalog(
  products: readonly ProductCatalogItem[],
  query: string,
  options: ProductCatalogSearchOptions = {},
): ProductCatalogItem[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return [];

  const result: ProductCatalogItem[] = [];
  for (const product of products) {
    if (options.stockManagedOnly && !product.isStockManaged) continue;
    if (options.excludeIds?.has(product.id)) continue;

    const searchable = normalizeSearch([
      product.name,
      product.sku,
      product.barcode ?? "",
      product.brandName ?? "",
      product.categoryName ?? "",
      ...product.units.flatMap((unit) => [unit.unitName, unit.barcode ?? ""]),
    ].join(" "));
    if (!searchable.includes(normalizedQuery)) continue;

    result.push(product);
    if (result.length >= (options.limit ?? 20)) break;
  }
  return result;
}

export function getCatalogWarehouseStock(
  product: ProductCatalogItem,
  warehouseId: string,
): number {
  return Number(
    product.warehouseStock.find((stock) => stock.warehouseId === warehouseId)?.quantity ?? 0,
  );
}
