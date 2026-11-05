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
type ProductCatalogSearchIndex = {
  productIndexesByTrigram: ReadonlyMap<string, Uint32Array>;
};
type ProductCatalogIdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};
type ProductCatalogIdleWindow = Window & {
  requestIdleCallback?: (
    callback: (deadline: ProductCatalogIdleDeadline) => void,
    options?: { timeout: number },
  ) => number;
};

const searchIndexesByProducts = new WeakMap<readonly ProductCatalogItem[], ProductCatalogSearchIndex>();
const buildingSearchIndexes = new WeakMap<readonly ProductCatalogItem[], object>();

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

/** Build the substring index in short idle-time slices so POS stays responsive. */
export function prepareProductCatalogSearchIndex(products: readonly ProductCatalogItem[]): () => void {
  if (
    products.length === 0
    || searchIndexesByProducts.has(products)
    || buildingSearchIndexes.has(products)
    || typeof window === "undefined"
  ) return () => undefined;

  const buildToken = {};
  buildingSearchIndexes.set(products, buildToken);
  const productIndexesByTrigram = new Map<string, number[]>();
  const lastProductIndexByTrigram = new Map<string, number>();
  let nextProductIndex = 0;
  let cancelled = false;

  const scheduleNextSlice = () => {
    const idleWindow = window as ProductCatalogIdleWindow;
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(processSlice, { timeout: 1_000 });
      return;
    }
    window.setTimeout(() => processSlice(), 0);
  };

  const processSlice = (deadline?: ProductCatalogIdleDeadline) => {
    if (cancelled) {
      if (buildingSearchIndexes.get(products) === buildToken) buildingSearchIndexes.delete(products);
      return;
    }

    const sliceStartedAt = performance.now();
    while (
      nextProductIndex < products.length
      && performance.now() - sliceStartedAt < 5
      && (!deadline || deadline.timeRemaining() > 1 || deadline.didTimeout)
    ) {
      const currentIndex = nextProductIndex;
      const characters = Array.from(productSearchText(products[currentIndex]));
      for (let offset = 0; offset <= characters.length - 3; offset += 1) {
        const trigram = characters[offset] + characters[offset + 1] + characters[offset + 2];
        if (lastProductIndexByTrigram.get(trigram) === currentIndex) continue;
        lastProductIndexByTrigram.set(trigram, currentIndex);
        const indexes = productIndexesByTrigram.get(trigram) ?? [];
        indexes.push(currentIndex);
        productIndexesByTrigram.set(trigram, indexes);
      }
      nextProductIndex += 1;
    }

    if (nextProductIndex < products.length) {
      scheduleNextSlice();
      return;
    }

    const compactIndex = new Map<string, Uint32Array>();
    for (const [trigram, indexes] of productIndexesByTrigram) {
      compactIndex.set(trigram, Uint32Array.from(indexes));
    }
    searchIndexesByProducts.set(products, { productIndexesByTrigram: compactIndex });
    if (buildingSearchIndexes.get(products) === buildToken) buildingSearchIndexes.delete(products);
    productIndexesByTrigram.clear();
    lastProductIndexByTrigram.clear();
  };

  scheduleNextSlice();
  return () => {
    cancelled = true;
    if (buildingSearchIndexes.get(products) === buildToken) buildingSearchIndexes.delete(products);
    productIndexesByTrigram.clear();
    lastProductIndexByTrigram.clear();
  };
}

function indexedProductCandidates(
  products: readonly ProductCatalogItem[],
  tokens: readonly string[],
): Uint32Array | null {
  const index = searchIndexesByProducts.get(products);
  if (!index) return null;

  let smallestPosting: Uint32Array | null = null;
  for (const token of tokens) {
    const characters = Array.from(token);
    if (characters.length < 3) continue;

    for (let offset = 0; offset <= characters.length - 3; offset += 1) {
      const trigram = characters[offset] + characters[offset + 1] + characters[offset + 2];
      const posting = index.productIndexesByTrigram.get(trigram);
      if (!posting) return new Uint32Array();
      if (!smallestPosting || posting.length < smallestPosting.length) {
        smallestPosting = posting;
        if (smallestPosting.length === 0) return smallestPosting;
      }
    }
  }

  return smallestPosting;
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

  const candidateIndexes = indexedProductCandidates(products, tokens);
  const result: ProductCatalogItem[] = [];
  const considerProduct = (product: ProductCatalogItem) => {
    if (options.stockManagedOnly && !product.isStockManaged) return;
    if (options.excludeIds?.has(product.id)) return;

    const searchable = productSearchText(product);
    if (!tokens.every((token) => searchable.includes(token))) return;

    result.push(product);
  };

  if (candidateIndexes) {
    for (const productIndex of candidateIndexes) {
      const product = products[productIndex];
      if (product) considerProduct(product);
      if (result.length >= (options.limit ?? 20)) break;
    }
  } else {
    for (const product of products) {
      considerProduct(product);
      if (result.length >= (options.limit ?? 20)) break;
    }
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
