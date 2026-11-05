import { normalizeSearch, searchTokens } from "@/lib/normalize";

export const PRODUCT_CATALOG_SCHEMA_VERSION = 12;
export const LEGACY_PRODUCT_CATALOG_SCHEMA_VERSION = 10;
export const PREVIOUS_PRODUCT_CATALOG_SCHEMA_VERSION = 11;

/** One tenant and permission scope for every web catalog cache and consumer. */
export function productCatalogScopeId(storeId: string, userId: string, role: string): string {
  return `${storeId}:${userId}:${role}`;
}

export function isProductCatalogCacheSchemaCompatible(schemaVersion: number) {
  return schemaVersion === PRODUCT_CATALOG_SCHEMA_VERSION
    || schemaVersion === PREVIOUS_PRODUCT_CATALOG_SCHEMA_VERSION
    || schemaVersion === LEGACY_PRODUCT_CATALOG_SCHEMA_VERSION;
}

export type ProductCatalogEntity = { id: string; name: string };
export type ProductCatalogMetadata = {
  categories: ProductCatalogEntity[];
  brands: ProductCatalogEntity[];
  suppliers: ProductCatalogEntity[];
};
export type ProductCatalogMetadataDelta = {
  categories?: { upserts: ProductCatalogEntity[]; deletedIds: string[] };
  brands?: { upserts: ProductCatalogEntity[]; deletedIds: string[] };
  suppliers?: { upserts: ProductCatalogEntity[]; deletedIds: string[] };
  warehouses?: { upserts: ProductCatalogWarehouse[]; deletedIds: string[] };
};

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
  description?: string | null;
  location?: string | null;
  weight?: string | null;
  dimensions?: string | null;
  createdAt?: string | Date;
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
  variantGroupId?: string | null;
  variantGroupKind?: "native" | "related" | string | null;
  combinationKey?: string | null;
  optionValueIds?: string[];
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
  schemaVersion: number;
  userId: string;
  scopeId: string;
  revision: string;
  savedAt: number;
  products: ProductCatalogItem[];
  warehouses: ProductCatalogWarehouse[];
  metadata?: ProductCatalogMetadata;
};

export type ProductCatalogDelta = {
  baseRevision: string;
  revision: string;
  schemaVersion: number;
  userId: string;
  scopeId: string;
  upserts: ProductCatalogItem[];
  deletedIds: string[];
  metadata?: ProductCatalogMetadataDelta;
  hasMore?: boolean;
};

type ProductCatalogSearchIndexChange = {
  previousProducts: readonly ProductCatalogItem[];
  changedProductsById: ReadonlyMap<string, ProductCatalogItem | null>;
};

const searchIndexChangesByProducts = new WeakMap<
  readonly ProductCatalogItem[],
  ProductCatalogSearchIndexChange
>();

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
  const metadata = mergeProductCatalogMetadata(snapshot.metadata, delta.metadata);
  const categoryNameById = new Map(metadata.categories.map((item) => [item.id, item.name]));
  const brandNameById = new Map(metadata.brands.map((item) => [item.id, item.name]));
  const supplierNameById = new Map(metadata.suppliers.map((item) => [item.id, item.name]));
  const changedProductIDs = new Set([...delta.upserts.map((product) => product.id), ...delta.deletedIds]);
  const projectedProducts: ProductCatalogItem[] = [];
  for (const product of productsById.values()) {
    const categoryName = product.categoryId ? categoryNameById.get(product.categoryId) ?? null : null;
    const brandName = product.brandId ? brandNameById.get(product.brandId) ?? null : null;
    const supplierName = product.supplierId ? supplierNameById.get(product.supplierId) ?? null : null;
    const projected = product.categoryName === categoryName
      && product.brandName === brandName
      && product.supplierName === supplierName
      ? product
      : { ...product, categoryName, brandName, supplierName };
    if (projected !== product) changedProductIDs.add(product.id);
    productsById.set(product.id, projected);
    projectedProducts.push(projected);
  }
  const products = sortByRecentProductSale(projectedProducts);
  const changedProductsById = new Map<string, ProductCatalogItem | null>();
  for (const id of changedProductIDs) changedProductsById.set(id, productsById.get(id) ?? null);
  searchIndexChangesByProducts.set(products, {
    previousProducts: snapshot.products,
    changedProductsById,
  });
  const warehouseChanges = delta.metadata?.warehouses;
  let warehouses = snapshot.warehouses;
  if (warehouseChanges) {
    const byId = new Map(warehouses.map((item) => [item.id, item]));
    for (const id of warehouseChanges.deletedIds) byId.delete(id);
    for (const item of warehouseChanges.upserts) byId.set(item.id, item);
    warehouses = [...byId.values()].sort((left, right) => (
      Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, "vi")
    ));
  }
  return { ...snapshot, revision: delta.revision, savedAt: Date.now(), products, warehouses, metadata };
}

function mergeProductCatalogMetadata(
  current: ProductCatalogMetadata | undefined,
  delta: ProductCatalogMetadataDelta | undefined,
): ProductCatalogMetadata {
  const result = {
    categories: [...(current?.categories ?? [])],
    brands: [...(current?.brands ?? [])],
    suppliers: [...(current?.suppliers ?? [])],
  };
  for (const key of ["categories", "brands", "suppliers"] as const) {
    const change = delta?.[key];
    if (!change) continue;
    const byId = new Map(result[key].map((item) => [item.id, item]));
    for (const id of change.deletedIds) byId.delete(id);
    for (const item of change.upserts) byId.set(item.id, item);
    result[key] = [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "vi"));
  }
  return result;
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
type ProductCatalogSearchIndexBase = {
  productIdsByTrigram: ReadonlyMap<string, ReadonlySet<string>>;
  trigramsByProductId: ReadonlyMap<string, readonly string[]>;
  productsById: ReadonlyMap<string, ProductCatalogItem>;
};
type ProductCatalogSearchIndex = {
  base: ProductCatalogSearchIndexBase;
  parent: ProductCatalogSearchIndex | null;
  addedByTrigram?: ReadonlyMap<string, ReadonlySet<string>>;
  removedByTrigram?: ReadonlyMap<string, ReadonlySet<string>>;
  changedTrigramsByProductId?: ReadonlyMap<string, readonly string[] | null>;
  changedProductsById?: ReadonlyMap<string, ProductCatalogItem | null>;
  depth: number;
  productCount: number;
  resolvedPostings: Map<string, ProductCatalogSearchPostingView>;
};
type ProductCatalogSearchPostingView = {
  base: ReadonlySet<string> | undefined;
  changes: ReadonlyMap<string, boolean>;
  size: number;
  [Symbol.iterator](): Iterator<string>;
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
const buildingSearchIndexPromises = new WeakMap<readonly ProductCatalogItem[], Promise<void>>();
const MAX_INCREMENTAL_INDEX_DEPTH = 12;
const MAX_INCREMENTAL_INDEX_PRODUCT_CHANGES = 1_000;

function productSearchText(product: ProductCatalogItem): string {
  const cached = searchableTextByProduct.get(product);
  if (cached != null) return cached;

  const fields = [
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
  ];
  const normalized = normalizeSearch(fields.join(" "));
  const compact = fields
    .map((value) => normalizeSearch(value).replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join(" ");
  const searchable = `${normalized} ${compact}`;
  searchableTextByProduct.set(product, searchable);
  return searchable;
}

function productTrigrams(searchable: string): string[] {
  const characters = Array.from(searchable);
  const trigrams = new Set<string>();
  for (let offset = 0; offset <= characters.length - 3; offset += 1) {
    trigrams.add(characters[offset] + characters[offset + 1] + characters[offset + 2]);
  }
  return [...trigrams];
}

function indexedProduct(
  index: ProductCatalogSearchIndex,
  productId: string,
): ProductCatalogItem | undefined {
  let current: ProductCatalogSearchIndex | null = index;
  while (current) {
    if (current.changedProductsById?.has(productId)) {
      return current.changedProductsById.get(productId) ?? undefined;
    }
    current = current.parent;
  }
  return index.base.productsById.get(productId);
}

function indexedProductTrigrams(
  index: ProductCatalogSearchIndex,
  productId: string,
): readonly string[] {
  let current: ProductCatalogSearchIndex | null = index;
  while (current) {
    if (current.changedTrigramsByProductId?.has(productId)) {
      return current.changedTrigramsByProductId.get(productId) ?? [];
    }
    current = current.parent;
  }
  return index.base.trigramsByProductId.get(productId) ?? [];
}

function updatedSearchIndex(
  previous: ProductCatalogSearchIndex,
  changes: ProductCatalogSearchIndexChange,
): ProductCatalogSearchIndex {
  const changedTrigramsByProductId = new Map<string, readonly string[] | null>();
  const changedProductsById = new Map<string, ProductCatalogItem | null>();
  const addedByTrigram = new Map<string, Set<string>>();
  const removedByTrigram = new Map<string, Set<string>>();
  let productCount = previous.productCount;

  const add = (postings: Map<string, Set<string>>, trigram: string, id: string) => {
    const ids = postings.get(trigram) ?? new Set<string>();
    ids.add(id);
    postings.set(trigram, ids);
  };

  for (const [id, product] of changes.changedProductsById) {
    const previousProduct = indexedProduct(previous, id);
    const previousTrigrams = indexedProductTrigrams(previous, id);
    const nextTrigrams = product ? productTrigrams(productSearchText(product)) : [];
    const previousSet = new Set(previousTrigrams);
    const nextSet = new Set(nextTrigrams);

    if (!previousProduct && product) productCount += 1;
    if (previousProduct && !product) productCount -= 1;
    changedProductsById.set(id, product);
    changedTrigramsByProductId.set(id, product ? nextTrigrams : null);

    for (const trigram of previousSet) {
      if (!nextSet.has(trigram)) add(removedByTrigram, trigram, id);
    }
    for (const trigram of nextSet) {
      if (!previousSet.has(trigram)) add(addedByTrigram, trigram, id);
    }
  }

  return {
    base: previous.base,
    parent: previous,
    addedByTrigram,
    removedByTrigram,
    changedTrigramsByProductId,
    changedProductsById,
    depth: previous.depth + 1,
    productCount,
    resolvedPostings: new Map(),
  };
}

function postingView(
  index: ProductCatalogSearchIndex,
  trigram: string,
): ProductCatalogSearchPostingView {
  const cached = index.resolvedPostings.get(trigram);
  if (cached) return cached;

  const changes = new Map<string, boolean>();
  let current: ProductCatalogSearchIndex | null = index;
  while (current) {
    for (const id of current.addedByTrigram?.get(trigram) ?? []) {
      if (!changes.has(id)) changes.set(id, true);
    }
    for (const id of current.removedByTrigram?.get(trigram) ?? []) {
      if (!changes.has(id)) changes.set(id, false);
    }
    current = current.parent;
  }

  const base = index.base.productIdsByTrigram.get(trigram);
  let size = base?.size ?? 0;
  for (const [id, present] of changes) {
    size += Number(present) - Number(base?.has(id) ?? false);
  }
  const view: ProductCatalogSearchPostingView = {
    base,
    changes,
    size,
    *[Symbol.iterator]() {
      for (const id of base ?? []) {
        if (changes.get(id) !== false) yield id;
      }
      for (const [id, present] of changes) {
        if (present && !base?.has(id)) yield id;
      }
    },
  };
  index.resolvedPostings.set(trigram, view);
  return view;
}

/** Build a full index in idle slices, then patch only delta-affected products. */
export function prepareProductCatalogSearchIndex(products: readonly ProductCatalogItem[]): () => void {
  if (
    products.length === 0
    || searchIndexesByProducts.has(products)
    || buildingSearchIndexes.has(products)
    || typeof window === "undefined"
  ) return () => undefined;

  const change = searchIndexChangesByProducts.get(products);
  const previousIndex = change ? searchIndexesByProducts.get(change.previousProducts) : undefined;
  if (
    change && previousIndex
    && previousIndex.depth < MAX_INCREMENTAL_INDEX_DEPTH
    && change.changedProductsById.size <= MAX_INCREMENTAL_INDEX_PRODUCT_CHANGES
  ) {
    searchIndexesByProducts.set(products, updatedSearchIndex(previousIndex, change));
    return () => undefined;
  }

  const buildToken = {};
  buildingSearchIndexes.set(products, buildToken);
  let resolveBuild!: () => void;
  const buildPromise = new Promise<void>((resolve) => { resolveBuild = resolve; });
  buildingSearchIndexPromises.set(products, buildPromise);
  const productIdsByTrigram = new Map<string, Set<string>>();
  const trigramsByProductId = new Map<string, readonly string[]>();
  const productsById = new Map<string, ProductCatalogItem>();
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
      resolveBuild();
      return;
    }

    const sliceStartedAt = performance.now();
    while (
      nextProductIndex < products.length
      && performance.now() - sliceStartedAt < 5
      && (!deadline || deadline.timeRemaining() > 1 || deadline.didTimeout)
    ) {
      const currentIndex = nextProductIndex;
      const product = products[currentIndex];
      const trigrams = productTrigrams(productSearchText(product));
      productsById.set(product.id, product);
      trigramsByProductId.set(product.id, trigrams);
      for (const trigram of trigrams) {
        const ids = productIdsByTrigram.get(trigram) ?? new Set<string>();
        ids.add(product.id);
        productIdsByTrigram.set(trigram, ids);
      }
      nextProductIndex += 1;
    }

    if (nextProductIndex < products.length) {
      scheduleNextSlice();
      return;
    }

    const base: ProductCatalogSearchIndexBase = {
      productIdsByTrigram,
      trigramsByProductId,
      productsById,
    };
    searchIndexesByProducts.set(products, {
      base,
      parent: null,
      depth: 0,
      productCount: productsById.size,
      resolvedPostings: new Map(),
    });
    if (buildingSearchIndexes.get(products) === buildToken) buildingSearchIndexes.delete(products);
    resolveBuild();
  };

  scheduleNextSlice();
  return () => {
    cancelled = true;
    if (buildingSearchIndexes.get(products) === buildToken) buildingSearchIndexes.delete(products);
    resolveBuild();
  };
}

/** Wait for the idle-built index; also used by deterministic browser benchmarks. */
export function waitForProductCatalogSearchIndex(products: readonly ProductCatalogItem[]): Promise<void> {
  return buildingSearchIndexPromises.get(products) ?? Promise.resolve();
}

/** Minimal diagnostics make index reuse and delta maintenance measurable. */
export function getProductCatalogSearchIndexStats(products: readonly ProductCatalogItem[]) {
  const index = searchIndexesByProducts.get(products);
  return index ? { depth: index.depth, productCount: index.productCount } : null;
}

function indexedProductCandidates(
  index: ProductCatalogSearchIndex,
  tokens: readonly string[],
): ProductCatalogSearchPostingView | null {

  let smallestPosting: ProductCatalogSearchPostingView | null = null;
  for (const token of tokens) {
    const characters = Array.from(token);
    if (characters.length < 3) continue;

    for (let offset = 0; offset <= characters.length - 3; offset += 1) {
      const trigram = characters[offset] + characters[offset + 1] + characters[offset + 2];
      const posting = postingView(index, trigram);
      if (posting.size === 0) return posting;
      if (!smallestPosting || posting.size < smallestPosting.size) {
        smallestPosting = posting;
        if (smallestPosting.size === 0) return smallestPosting;
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

  const index = searchIndexesByProducts.get(products);
  const candidates = index ? indexedProductCandidates(index, tokens) : null;
  const result: Array<{ product: ProductCatalogItem; score: number[] }> = [];
  const considerProduct = (product: ProductCatalogItem) => {
    if (options.stockManagedOnly && !product.isStockManaged) return;
    if (options.excludeIds?.has(product.id)) return;

    const searchable = productSearchText(product);
    if (!tokens.every((token) => searchable.includes(token))) return;
    const queryKey = tokens.join(" ");
    const name = normalizeSearch(product.name);
    const normalizeCode = (value: string) => normalizeSearch(value).replace(/[^a-z0-9]/g, "");
    const queryCode = normalizeCode(query);
    const sku = normalizeCode(product.sku);
    const barcode = normalizeCode(product.barcode ?? "");
    const unitSKUs = product.units.map((unit) => normalizeCode(unit.sku ?? ""));
    const unitBarcodes = product.units.map((unit) => normalizeCode(unit.barcode ?? ""));
    const exactSKU = Number(sku === queryCode || unitSKUs.includes(queryCode));
    const exactBarcode = Number(barcode === queryCode || unitBarcodes.includes(queryCode));
    const compactName = normalizeCode(product.name);
    const exactName = Number(name === queryKey || compactName === queryCode);
    const prefixCode = Number(
      sku.startsWith(queryCode) || barcode.startsWith(queryCode)
      || unitSKUs.some((value) => value.startsWith(queryCode))
      || unitBarcodes.some((value) => value.startsWith(queryCode)),
    );
    const prefixName = Number(name.startsWith(queryKey) || compactName.startsWith(queryCode));
    const nameTokens = searchTokens(name);
    const codeTokens = searchTokens([product.sku, product.barcode ?? "", ...unitSKUs, ...unitBarcodes].join(" "));
    const nameMatches = tokens.filter((token) => nameTokens.some((candidate) => candidate.startsWith(token) || candidate.includes(token))).length;
    const codeMatches = tokens.filter((token) => codeTokens.some((candidate) => candidate.startsWith(token) || candidate.includes(token))).length;
    const otherMatches = tokens.filter((token) => searchable.includes(token)).length;
    result.push({ product, score: [exactSKU, exactBarcode, exactName, prefixCode, prefixName, nameMatches, codeMatches, otherMatches] });
  };

  // When a query matches most of the catalog, a contiguous array scan avoids
  // the set iteration overhead while preserving the indexed path for selective
  // SKU, barcode, name, and metadata searches.
  if (candidates && index && candidates.size < index.productCount / 2) {
    for (const productId of candidates) {
      const product = indexedProduct(index, productId);
      if (product) considerProduct(product);
    }
  } else {
    products.forEach((product) => considerProduct(product));
  }
  result.sort((left, right) => {
    for (let index = 0; index < left.score.length; index += 1) {
      if (left.score[index] !== right.score[index]) return right.score[index] - left.score[index];
    }
    const leftDate = left.product.lastSoldAt ? new Date(left.product.lastSoldAt).getTime() : 0;
    const rightDate = right.product.lastSoldAt ? new Date(right.product.lastSoldAt).getTime() : 0;
    return rightDate - leftDate
      || left.product.name.localeCompare(right.product.name, "vi")
      || left.product.id.localeCompare(right.product.id);
  });
  return result.slice(0, options.limit ?? 20).map(({ product }) => product);
}

export function getCatalogWarehouseStock(
  product: ProductCatalogItem,
  warehouseId: string,
): number {
  return Number(
    product.warehouseStock.find((stock) => stock.warehouseId === warehouseId)?.quantity ?? 0,
  );
}
