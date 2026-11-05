import { expect, test } from "bun:test";
import {
  isProductCatalogCacheSchemaCompatible,
  mergeProductCatalogDelta,
  searchProductCatalog,
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

test("benchmarks local search and delta projection at 1k, 10k, and 50k products", () => {
  const measurements = [];
  for (const size of [1_000, 10_000, 50_000]) {
    const products = Array.from({ length: size }, (_, index) => product({
      id: `product-${index}`,
      sku: `SKU-${String(index).padStart(5, "0")}`,
      name: `Product ${index}`,
    }));
    const started = performance.now();
    const exact = searchProductCatalog(products, `SKU-${String(size - 1).padStart(5, "0")}`, { limit: 20 });
    const exactSearchMs = performance.now() - started;
    expect(exact[0]?.id).toBe(`product-${size - 1}`);

    const broadStarted = performance.now();
    const broad = searchProductCatalog(products, "product", { limit: 20 });
    const broadSearchMs = performance.now() - broadStarted;
    expect(broad.length).toBe(20);

    const base = snapshot(products);
    const changed = product({ id: `product-${size - 1}`, sku: `SKU-${String(size - 1).padStart(5, "0")}`, name: `Renamed ${size - 1}` });
    const deltaStarted = performance.now();
    const merged = mergeProductCatalogDelta(base, {
      baseRevision: "10", revision: "11", schemaVersion: 12,
      userId: "u", scopeId: "s:u:owner", upserts: [changed], deletedIds: [],
    });
    const deltaApplyMs = performance.now() - deltaStarted;
    expect(merged?.products.find((row) => row.id === changed.id)?.name).toBe(changed.name);
    measurements.push({ size, exactSearchMs, broadSearchMs, deltaApplyMs });
  }
  console.info("[catalog-benchmark] synthetic", JSON.stringify(measurements));
});
