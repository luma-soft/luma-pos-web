import { expect, test } from "bun:test";
import {
  getProductCatalogSearchIndexStats,
  isProductCatalogCacheSchemaCompatible,
  mergeProductCatalogDelta,
  prepareProductCatalogSearchIndex,
  productCatalogScopeId,
  searchProductCatalog,
  waitForProductCatalogSearchIndex,
} from "./product-catalog";

function product(overrides = {}) {
  return {
    id: "p",
    sku: "SKU-P",
    barcode: null,
    name: "Sản phẩm",
    productKind: "product",
    isActive: true,
    lifecycleStatus: "active",
    trackBatches: false,
    brandId: null,
    brandName: null,
    model: null,
    categoryId: null,
    categoryName: null,
    baseUnit: "cái",
    baseUnitDirectSale: true,
    costPrice: null,
    retailPrice: "10",
    wholesalePrice: null,
    contractorPrice: null,
    agentPrice: null,
    imageUrls: [],
    imageUpdatedAt: "2026-01-01T00:00:00.000Z",
    specs: {},
    parentProductId: null,
    relatedProductId: null,
    variantName: null,
    isVariantParent: false,
    m2PerUnit: null,
    priceByWeight: false,
    vatRate: null,
    isStockManaged: true,
    comboItems: [],
    units: [],
    prices: {},
    warehouseStock: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastSoldAt: null,
    ...overrides,
  };
}

const snapshot = (products, metadata = {}) => ({
  schemaVersion: 12,
  userId: "u",
  scopeId: "s:u:owner",
  revision: "10",
  savedAt: 1,
  products,
  warehouses: [],
  metadata: { categories: [], brands: [], suppliers: [], ...metadata },
});

test("keeps older local catalog schemas usable until their full sync completes", () => {
  expect([10, 11, 12].every(isProductCatalogCacheSchemaCompatible)).toBe(true);
  expect(isProductCatalogCacheSchemaCompatible(9)).toBe(false);
  expect(isProductCatalogCacheSchemaCompatible(13)).toBe(false);
});

test("catalog cache scope includes and isolates store, user, and role", () => {
  const scope = productCatalogScopeId("store-1", "user-1", "manager");
  expect(scope).toBe("store-1:user-1:manager");
  expect(productCatalogScopeId("store-2", "user-1", "manager")).not.toBe(scope);
  expect(productCatalogScopeId("store-1", "user-2", "manager")).not.toBe(scope);
  expect(productCatalogScopeId("store-1", "user-1", "cashier")).not.toBe(scope);
});

test("search ranks exact SKU/barcode before exact name and ranks before truncating", () => {
  const rows = [
    product({ id: "prefix", sku: "AB-123X", name: "Other" }),
    product({ id: "name", sku: "OTHER", name: "AB 123" }),
    product({ id: "barcode", sku: "OTHER2", barcode: "AB123" }),
    product({ id: "sku", sku: "AB123", name: "Third" }),
  ];
  expect(searchProductCatalog(rows, "AB 123", { limit: 4 }).map((row) => row.id))
    .toEqual(["sku", "barcode", "name", "prefix"]);
});

test("metadata-only rename updates local product projections without product upserts", () => {
  const current = snapshot([
    product({ id: "one", categoryId: "c1", categoryName: "Old category", supplierId: "s1", supplierName: "Old supplier" }),
    product({ id: "two", categoryId: "c2", categoryName: "Other category" }),
  ], {
    categories: [{ id: "c1", name: "Old category" }, { id: "c2", name: "Other category" }],
    suppliers: [{ id: "s1", name: "Old supplier" }],
  });
  const next = mergeProductCatalogDelta(current, {
    baseRevision: "10",
    revision: "11",
    schemaVersion: 12,
    userId: "u",
    scopeId: "s:u:owner",
    upserts: [],
    deletedIds: [],
    metadata: {
      categories: { upserts: [{ id: "c1", name: "New category" }], deletedIds: [] },
      suppliers: { upserts: [{ id: "s1", name: "New supplier" }], deletedIds: [] },
    },
  });
  expect(next.products.map(({ categoryName, supplierName }) => ({ categoryName, supplierName }))).toEqual([
    { categoryName: "New category", supplierName: "New supplier" },
    { categoryName: "Other category", supplierName: null },
  ]);
  expect(next.metadata.categories).toContainEqual({ id: "c1", name: "New category" });
});

test("patches the stable search index for changed products and metadata after a delta", async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { setTimeout: (callback) => setTimeout(callback, 0) },
  });
  try {
    const current = snapshot([
      product({ id: "a", sku: "CODE-A", categoryId: "c1", categoryName: "Old category" }),
      product({ id: "b", sku: "OLD-CODE" }),
      product({ id: "c", sku: "DELETE-CODE" }),
    ], { categories: [{ id: "c1", name: "Old category" }] });
    prepareProductCatalogSearchIndex(current.products);
    await waitForProductCatalogSearchIndex(current.products);
    expect(getProductCatalogSearchIndexStats(current.products)).toEqual({ depth: 0, productCount: 3 });

    const next = mergeProductCatalogDelta(current, {
      baseRevision: "10", revision: "11", schemaVersion: 12,
      userId: "u", scopeId: "s:u:owner",
      upserts: [product({ id: "b", sku: "NEW-CODE" })],
      deletedIds: ["c"],
      metadata: { categories: { upserts: [{ id: "c1", name: "New category" }], deletedIds: [] } },
    });
    expect(next).not.toBeNull();
    prepareProductCatalogSearchIndex(next.products);
    expect(getProductCatalogSearchIndexStats(next.products)).toEqual({ depth: 1, productCount: 2 });
    expect(searchProductCatalog(next.products, "NEWCODE").map((row) => row.id)).toEqual(["b"]);
    expect(searchProductCatalog(next.products, "OLD-CODE")).toEqual([]);
    expect(searchProductCatalog(next.products, "DELETE-CODE")).toEqual([]);
    expect(searchProductCatalog(next.products, "New category").map((row) => row.id)).toEqual(["a"]);
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else delete globalThis.window;
  }
});

test("benchmarks indexed and fallback search plus delta projection at 1k, 10k, and 50k products", async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { setTimeout: (callback) => setTimeout(callback, 0) },
  });
  const measurements = [];
  const medianSearchMs = (products, query) => {
    searchProductCatalog(products, query, { limit: 20 });
    const samples = [];
    for (let repeat = 0; repeat < 7; repeat += 1) {
      const started = performance.now();
      searchProductCatalog(products, query, { limit: 20 });
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    return samples[Math.floor(samples.length / 2)];
  };

  try {
    for (const size of [1_000, 10_000, 50_000]) {
      const products = Array.from({ length: size }, (_, index) => product({
        id: `product-${index}`,
        sku: `SKU-${String(index).padStart(5, "0")}`,
        barcode: index === size - 1 ? `BAR-${String(index).padStart(5, "0")}` : null,
        name: `Product ${index}`,
        supplierId: null,
        supplierName: null,
      }));
      const fallbackProducts = [...products];
      const indexedProducts = [...products];
      const indexStarted = performance.now();
      prepareProductCatalogSearchIndex(indexedProducts);
      await waitForProductCatalogSearchIndex(indexedProducts);
      const indexBuildMs = performance.now() - indexStarted;
      expect(getProductCatalogSearchIndexStats(indexedProducts))
        .toEqual({ depth: 0, productCount: size });

      const queries = [
        [`SKU-${String(size - 1).padStart(5, "0")}`, `product-${size - 1}`],
        [`BAR-${String(size - 1).padStart(5, "0")}`, `product-${size - 1}`],
        [`Product ${size - 1}`, `product-${size - 1}`],
        ["Product", null],
      ];
      const searchTimings = {};
      for (const [query, expectedId] of queries) {
        const fallbackIds = searchProductCatalog(fallbackProducts, query, { limit: 20 })
          .map((row) => row.id);
        const indexedIds = searchProductCatalog(indexedProducts, query, { limit: 20 })
          .map((row) => row.id);
        expect(indexedIds).toEqual(fallbackIds);
        if (expectedId) expect(indexedIds[0]).toBe(expectedId);
        else expect(indexedIds).toHaveLength(20);
        searchTimings[query] = {
          fallbackMedianMs: medianSearchMs(fallbackProducts, query),
          indexedMedianMs: medianSearchMs(indexedProducts, query),
        };
      }

      const base = snapshot(indexedProducts);
      const changed = product({
        ...indexedProducts[size - 1],
        id: `product-${size - 1}`,
        sku: `SKU-${String(size - 1).padStart(5, "0")}`,
        name: `Renamed ${size - 1}`,
      });
      const deltaStarted = performance.now();
      const merged = mergeProductCatalogDelta(base, {
        baseRevision: "10", revision: "11", schemaVersion: 12,
        userId: "u", scopeId: "s:u:owner", upserts: [changed], deletedIds: [],
      });
      const deltaApplyMs = performance.now() - deltaStarted;
      expect(merged?.products.find((row) => row.id === changed.id)?.name).toBe(changed.name);
      const deltaIndexStarted = performance.now();
      prepareProductCatalogSearchIndex(merged.products);
      const deltaIndexPatchMs = performance.now() - deltaIndexStarted;
      expect(getProductCatalogSearchIndexStats(merged.products))
        .toEqual({ depth: 1, productCount: size });
      expect(searchProductCatalog(merged.products, `Renamed ${size - 1}`)[0]?.id)
        .toBe(`product-${size - 1}`);
      measurements.push({ size, indexBuildMs, searchTimings, deltaApplyMs, deltaIndexPatchMs });
    }
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else delete globalThis.window;
  }
  console.info("[catalog-benchmark] indexed-vs-fallback", JSON.stringify(measurements));
});

test("full lifecycle catalog retains inactive rows through deltas and deletion tombstones", () => {
  const full = snapshot([
    product({ id: "active", sku: "SKU-A", lifecycleStatus: "active", isActive: true }),
    product({ id: "inactive", sku: "SKU-I", lifecycleStatus: "inactive", isActive: false }),
    product({ id: "draft", sku: "SKU-D", lifecycleStatus: "draft", isActive: false }),
    product({ id: "archived", sku: "SKU-R", lifecycleStatus: "archived", isActive: false }),
  ]);
  const afterStatusChange = mergeProductCatalogDelta(full, {
    baseRevision: "10", revision: "11", schemaVersion: 12,
    userId: "u", scopeId: "s:u:owner",
    upserts: [product({ id: "active", sku: "SKU-A", lifecycleStatus: "inactive", isActive: false })],
    deletedIds: [],
  });
  expect(afterStatusChange?.products).toHaveLength(4);
  expect(afterStatusChange?.products.find((row) => row.id === "active")?.lifecycleStatus)
    .toBe("inactive");
  expect(afterStatusChange?.products.find((row) => row.id === "draft")?.isActive).toBe(false);

  const afterDeletion = mergeProductCatalogDelta(afterStatusChange, {
    baseRevision: "11", revision: "12", schemaVersion: 12,
    userId: "u", scopeId: "s:u:owner",
    upserts: [], deletedIds: ["archived"],
  });
  expect(afterDeletion?.products.map(({ id }) => id).sort())
    .toEqual(["active", "draft", "inactive"]);
  expect(afterDeletion?.revision).toBe("12");
});

test("rejects a delta from another actor or the wrong base revision", () => {
  const current = snapshot([product()]);
  const delta = {
    baseRevision: "10", revision: "11", schemaVersion: 12,
    userId: "other-user", scopeId: "s:other-user:owner",
    upserts: [product({ id: "new" })], deletedIds: [],
  };
  expect(mergeProductCatalogDelta(current, delta)).toBeNull();
  expect(mergeProductCatalogDelta(current, {
    ...delta, userId: "u", scopeId: "s:u:owner", baseRevision: "9",
  })).toBeNull();
});
