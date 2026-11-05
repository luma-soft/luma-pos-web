import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import { mergeProductCatalogDelta } from "@/lib/product-catalog";
import {
  productCatalogWriteChangesForSync,
  readProductCatalogSnapshot,
  writeProductCatalogSnapshot,
} from "./product-catalog-store";

function product(id, overrides = {}) {
  return {
    id,
    sku: `SKU-${id}`,
    barcode: null,
    name: `Product ${id}`,
    productKind: "product",
    isActive: true,
    lifecycleStatus: "active",
    trackBatches: false,
    supplierId: null,
    supplierName: null,
    brandId: null,
    brandName: null,
    model: null,
    categoryId: null,
    categoryName: null,
    baseUnit: "cái",
    baseUnitDirectSale: true,
    costPrice: "10",
    retailPrice: "20",
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

function snapshot(revision, products, metadata = {}) {
  return {
    schemaVersion: 12,
    userId: "user-a",
    scopeId: "store-a:user-a:manager",
    revision,
    savedAt: Number(revision),
    products,
    warehouses: [{ id: "w1", name: "Main", isDefault: true }],
    metadata: { categories: [], brands: [], suppliers: [], ...metadata },
  };
}

test("invalid delta recovery replaces the whole IndexedDB scope and reloads at its revision", async () => {
  const initial = snapshot("41", [
    product("keep"),
    product("delete-me"),
  ], { categories: [{ id: "c1", name: "Old" }] });
  expect(await writeProductCatalogSnapshot(initial)).toBe(true);

  const invalidDelta = {
    baseRevision: "40",
    revision: "42",
    schemaVersion: 12,
    userId: "user-a",
    scopeId: "store-a:user-a:manager",
    upserts: [product("stale", { sku: "STALE-SKU" })],
    deletedIds: ["delete-me"],
  };
  expect(mergeProductCatalogDelta(initial, invalidDelta)).toBeNull();

  const recovered = snapshot("43", [
    product("keep", { sku: "SKU-UPDATED", name: "Updated product", lifecycleStatus: "inactive", isActive: false }),
    product("new", { sku: "SKU-NEW", lifecycleStatus: "draft", isActive: false }),
  ], { categories: [{ id: "c1", name: "Renamed" }] });
  const writeChanges = productCatalogWriteChangesForSync(invalidDelta, false, ["stale"]);
  expect(writeChanges).toBeUndefined();
  expect(await writeProductCatalogSnapshot(recovered, writeChanges)).toBe(true);

  // A fresh read models a page reload: no in-memory catalog is consulted.
  const reloaded = await readProductCatalogSnapshot(recovered.scopeId);
  expect(reloaded?.revision).toBe("43");
  expect(reloaded?.metadata).toEqual(recovered.metadata);
  expect(reloaded?.warehouses).toEqual(recovered.warehouses);
  expect(reloaded?.products.map(({ id, sku, lifecycleStatus }) => ({ id, sku, lifecycleStatus })))
    .toEqual([
      { id: "keep", sku: "SKU-UPDATED", lifecycleStatus: "inactive" },
      { id: "new", sku: "SKU-NEW", lifecycleStatus: "draft" },
    ]);
  expect(reloaded?.products.some(({ id }) => id === "delete-me" || id === "stale")).toBe(false);
});

test("only a validated incremental delta receives row-level write instructions", () => {
  const delta = {
    baseRevision: "41", revision: "42", schemaVersion: 12,
    userId: "user-a", scopeId: "store-a:user-a:manager",
    upserts: [product("keep")], deletedIds: ["delete-me"],
  };
  expect(productCatalogWriteChangesForSync(delta, false, ["keep"])).toBeUndefined();
  expect(productCatalogWriteChangesForSync(delta, true, ["keep"])).toEqual({
    baseRevision: "41",
    changedProductIDs: ["keep"],
    deletedProductIDs: ["delete-me"],
  });
});
