import { normalizeSearch, searchTokens } from "@/lib/normalize";

export const PRODUCT_CATALOG_SCHEMA_VERSION = 10;

export type CatalogUnit = {
  unitName: string;
  multiplier: string;
  sku?: string | null;
  barcode: string | null;
  priceOverride: string | null;
  directSale: boolean;
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
  productKind: "product" | "service" | "combo";
  // Optional to remain compatible with existing web offline snapshots. The
  // mobile full-catalog endpoint always supplies these fields.
  isActive?: boolean;
  lifecycleStatus?: string;
  trackBatches?: boolean;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierIDs?: string[];
  minStock?: string;
  totalStock?: string;
  brandId: string | null;
  brandName: string | null;
  model: string | null;
  categoryId: string | null;
  categoryName: string | null;
  baseUnit: string;
  baseUnitDirectSale: boolean;
  costPrice: string | null;
  lastPurchasePrice?: string | null;
  lastPurchaseNetPrice?: string | null;
  retailPrice: string;
  wholesalePrice: string | null;
  contractorPrice: string | null;
  agentPrice: string | null;
  imageUrls: string[] | null;
  imageUpdatedAt: string;
  specs: unknown;
  parentProductId: string | null;
  // Legacy related-product families are grouped ONLY in Inventory's list.
  // Keep optional for older persisted web snapshots; new mobile full/delta
  // snapshots always include this field, including explicit null roots.
  relatedProductId?: string | null;
  variantName: string | null;
  isVariantParent: boolean;
  m2PerUnit: string | null;
  priceByWeight: boolean;
  vatRate: string | null;
  isStockManaged: boolean;
  comboItems: Array<{
    productId: string;
    quantity: string;
  }>;
  units: CatalogUnit[];
  priceBookTypes?: Record<string, "retail" | "cost" | "purchase" | "list" | null>;
  prices: Record<string, string | null>;
  warehouseStock: CatalogWarehouseStock[];
  updatedAt: string;
  lastSoldAt: string | null;
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
  revision: string;
  savedAt: number;
  products: ProductCatalogItem[];
  warehouses: ProductCatalogWarehouse[];
};

export type ProductCatalogDelta = {
  baseRevision: string;
  revision: string;
  schemaVersion: number;
  userId: string;
  scopeId: string;
  upserts: ProductCatalogItem[];
  deletedIds: string[];
};

export function sortByRecentProductSale<T extends Pick<ProductCatalogItem, "id" | "name" | "lastSoldAt">>(
  rows: readonly T[],
): T[] {
  const timestamp = (value: string | null) => value ? new Date(value).getTime() : 0;
  return [...rows].sort((left, right) => (
    timestamp(right.lastSoldAt) - timestamp(left.lastSoldAt)
    || left.name.localeCompare(right.name, "vi")
    || left.id.localeCompare(right.id)
  ));
}

export function mergeProductCatalogDelta(
  snapshot: ProductCatalogSnapshot,
  delta: ProductCatalogDelta,
): ProductCatalogSnapshot | null {
  if (
    snapshot.revision !== delta.baseRevision
    || snapshot.scopeId !== delta.scopeId
    || snapshot.userId !== delta.userId
    || snapshot.schemaVersion !== delta.schemaVersion
    || !catalogRevisionChanged(delta.baseRevision, delta.revision)
  ) return null;

  const productsById = new Map(snapshot.products.map((product) => [product.id, product]));
  for (const id of delta.deletedIds) productsById.delete(id);
  for (const product of delta.upserts) productsById.set(product.id, product);
  const products = sortByRecentProductSale([...productsById.values()]);
  return { ...snapshot, revision: delta.revision, savedAt: Date.now(), products };
}

export function catalogRevisionChanged(
  localRevision: string | null | undefined,
  remoteRevision: string | null | undefined,
): boolean {
  if (!remoteRevision) return false;
  if (!localRevision) return true;
  try {
    return BigInt(remoteRevision) > BigInt(localRevision);
  } catch {
    return localRevision !== remoteRevision;
  }
}

export type ProductCatalogSearchOptions = {
  stockManagedOnly?: boolean;
  excludeIds?: ReadonlySet<string>;
  limit?: number;
};

const searchableTextByProduct = new WeakMap<ProductCatalogItem, string>();

function productSearchText(product: ProductCatalogItem): string {
  const cached = searchableTextByProduct.get(product);
  if (cached != null) return cached;

  const searchable = normalizeSearch([
    product.name,
    product.sku,
    product.barcode ?? "",
    product.variantName ?? "",
    product.model ?? "",
    product.brandName ?? "",
    product.categoryName ?? "",
    product.baseUnit ?? "",
    JSON.stringify(product.specs ?? {}),
    ...product.units.flatMap((unit) => [unit.unitName, unit.sku ?? "", unit.barcode ?? ""]),
  ].join(" "));
  searchableTextByProduct.set(product, searchable);
  return searchable;
}

export function searchProductCatalog(
  products: readonly ProductCatalogItem[],
  query: string,
  options: ProductCatalogSearchOptions = {},
): ProductCatalogItem[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return [];
  const tokens = searchTokens(normalizedQuery);
  if (tokens.length === 0) return [];

  const result: ProductCatalogItem[] = [];
  for (const product of products) {
    if (options.stockManagedOnly && !product.isStockManaged) continue;
    if (options.excludeIds?.has(product.id)) continue;

    const searchable = productSearchText(product);
    if (!tokens.every((token) => searchable.includes(token))) continue;

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
