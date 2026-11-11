import { expect, test } from "bun:test";
import { exploreProductCatalog, getInventorySearchableProducts, visibleProductSelections } from "./product-catalog-explorer";

function product(overrides = {}) {
  return {
    id: "p-1",
    sku: "SKU-1",
    barcode: null,
    name: "Sản phẩm mẫu",
    productKind: "product",
    isActive: true,
    lifecycleStatus: "active",
    trackBatches: false,
    supplierId: null,
    supplierIDs: [],
    minStock: "2",
    totalStock: "5",
    brandId: null,
    brandName: null,
    model: null,
    categoryId: null,
    categoryName: null,
    baseUnit: "cái",
    baseUnitDirectSale: true,
    costPrice: "10",
    lastPurchasePrice: "11",
    lastPurchaseNetPrice: "8",
    retailPrice: "20",
    wholesalePrice: null,
    contractorPrice: null,
    agentPrice: null,
    imageUrls: [],
    imageUpdatedAt: "2026-01-01T00:00:00.000Z",
    specs: {},
    parentProductId: null,
    relatedProductId: null,
    variantGroupId: null,
    variantGroupKind: null,
    combinationKey: null,
    optionValueIds: [],
    variantName: null,
    isVariantParent: false,
    m2PerUnit: null,
    priceByWeight: false,
    vatRate: null,
    isStockManaged: true,
    comboItems: [],
    units: [],
    priceBookTypes: {},
    prices: {},
    warehouseStock: [{ warehouseId: "w1", quantity: "5", reserved: "1", minLevel: "2" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastSoldAt: null,
    ...overrides,
  };
}

test("groups legacy related products locally and filters on matching members", () => {
  const root = product({ id: "root", sku: "ROOT", name: "Ống PVC", relatedProductId: null });
  const member = product({
    id: "member", sku: "PVC-110", name: "Ống PVC 110",
    categoryId: "pipes", categoryName: "Ống nước", relatedProductId: "root",
    variantGroupId: "root", variantGroupKind: "related", variantName: "110",
  });

  const result = exploreProductCatalog([root, member], [], {
    query: "PVC 110",
    categoryId: "pipes",
    view: "grouped",
    status: "active",
    page: 1,
    pageSize: 20,
  });

  expect(result.total).toBe(1);
  expect(result.rows[0].id).toBe("root");
  expect(result.rows[0].variantGroup?.kind).toBe("related");
  expect(result.rows[0].variantGroup?.members.map((row) => row.id)).toEqual(["member"]);
  expect(result.rows[0].variantGroup?.count).toBe(1);
});

test("ranks the complete local candidate set before pagination", () => {
  const rows = [
    product({ id: "prefix", sku: "AB123X", name: "Other" }),
    product({ id: "name", sku: "OTHER", name: "AB 123" }),
    product({ id: "exact", sku: "AB123", name: "Third" }),
  ];
  const result = exploreProductCatalog(rows, [], { query: "AB123", view: "flat", page: 1, pageSize: 1 });
  expect(result.rows.map((row) => row.id)).toEqual(["exact"]);
  expect(result.total).toBe(3);
});

test("orders a grouped family by its first SKU in the configured product order", () => {
  const parent = product({
    id: "variant-parent",
    sku: "PARENT",
    name: "Family",
    isVariantParent: true,
    lastSoldAt: null,
  });
  const newestMember = product({
    id: "variant-newest",
    sku: "SKU-NEWEST",
    name: "Family newest",
    parentProductId: "variant-parent",
    lastSoldAt: "2026-11-05T00:00:00.000Z",
  });
  const olderMember = product({
    id: "variant-older",
    sku: "SKU-OLDER",
    name: "Family older",
    parentProductId: "variant-parent",
    lastSoldAt: "2026-11-01T00:00:00.000Z",
  });
  const standalone = product({
    id: "standalone",
    sku: "SKU-STANDALONE",
    name: "Standalone",
    lastSoldAt: "2026-11-03T00:00:00.000Z",
  });
  const catalog = [parent, olderMember, standalone, newestMember];

  const flat = exploreProductCatalog(catalog, [], {
    status: "active", view: "flat", sort: "recent_sales",
  });
  const grouped = exploreProductCatalog(catalog, [], {
    status: "active", view: "grouped", sort: "recent_sales",
  });

  expect(flat.rows.map((row) => row.id)).toEqual([
    "variant-newest", "standalone", "variant-older",
  ]);
  expect(grouped.rows.map((row) => row.id)).toEqual(["variant-parent", "standalone"]);
});

test("applies lifecycle and price comparisons locally", () => {
  const rows = [
    product({ id: "active", sku: "A", priceBookTypes: { costBook: "cost" } }),
    product({ id: "inactive", sku: "B", isActive: false, lifecycleStatus: "archived", priceBookTypes: { costBook: "cost" } }),
  ];
  const active = exploreProductCatalog(rows, [], {
    status: "active", view: "flat", priceCondition: "eq", priceAgainst: "cost", priceBookId: "costBook",
  });
  const inactive = exploreProductCatalog(rows, [], { status: "inactive", view: "flat" });
  expect(active.rows.map((row) => row.id)).toEqual(["active"]);
  expect(inactive.rows.map((row) => row.id)).toEqual(["inactive"]);
});


test("reuses the Inventory searchable view while excluding variant parent placeholders", () => {
  const parent = product({ id: "parent", sku: "PARENT", isVariantParent: true });
  const sku = product({ id: "sku", sku: "SKU" });
  const catalog = [parent, sku];
  const first = getInventorySearchableProducts(catalog);
  expect(first).toEqual([sku]);
  expect(getInventorySearchableProducts(catalog)).toBe(first);
  expect(getInventorySearchableProducts([...catalog])).not.toBe(first);

  const noParents = [sku];
  expect(getInventorySearchableProducts(noParents)).toBe(noParents);
});

test("group SKU counts and expanded rows use active search and filters", () => {
  const parent = product({ id: "parent", sku: "GROUP", isVariantParent: true });
  const active = product({
    id: "active", sku: "TILE-1", parentProductId: "parent",
    categoryId: "tile", brandId: "brand-a",
  });
  const stopped = product({
    id: "stopped", sku: "TILE-2", parentProductId: "parent",
    isActive: false, lifecycleStatus: "archived", categoryId: "tile", brandId: "brand-a",
  });
  const otherBrand = product({
    id: "other-brand", sku: "TILE-3", parentProductId: "parent",
    categoryId: "tile", brandId: "brand-b",
  });
  const catalog = [parent, active, stopped, otherBrand];

  const activeResult = exploreProductCatalog(catalog, [], {
    status: "active", brandId: "brand-a", view: "grouped",
  });
  expect(activeResult.total).toBe(1);
  expect(activeResult.rows[0].variantGroup?.count).toBe(1);
  expect(activeResult.rows[0].variantGroup?.members.map((row) => row.id)).toEqual(["active"]);
  expect(activeResult.rows[0].childCount).toBe(1);
  expect(activeResult.rows[0].children.map((row) => row.id)).toEqual(["active"]);

  const stoppedResult = exploreProductCatalog(catalog, [], {
    status: "inactive", query: "TILE-2", view: "grouped",
  });
  expect(stoppedResult.total).toBe(1);
  expect(stoppedResult.rows[0].variantGroup?.count).toBe(1);
  expect(stoppedResult.rows[0].variantGroup?.members.map((row) => row.id)).toEqual(["stopped"]);

  const flatResult = exploreProductCatalog(catalog, [], {
    status: "active", brandId: "brand-a", view: "flat",
  });
  expect(flatResult.total).toBe(1);
  expect(flatResult.rows.map((row) => row.id)).toEqual(["active"]);
});

test("bulk selection respects active/inactive variants and skips parents and duplicates", () => {
  const parent = product({ id: "parent", isVariantParent: true });
  const active = product({ id: "active-child", parentProductId: "parent" });
  const inactive = product({
    id: "inactive-child", parentProductId: "parent",
    isActive: false, lifecycleStatus: "archived",
  });
  const groupRow = { ...parent, variantGroup: { members: [parent, active, inactive, active] } };
  const standalone = product({ id: "inactive-standalone", isActive: false, lifecycleStatus: "archived" });
  const rows = [groupRow, standalone];

  expect(visibleProductSelections(rows, true, "active")).toEqual([
    { id: "active-child", isActive: true },
  ]);
  expect(visibleProductSelections(rows, true, "inactive")).toEqual([
    { id: "inactive-child", isActive: false },
    { id: "inactive-standalone", isActive: false },
  ]);
  expect(visibleProductSelections(rows, true, "all")).toEqual([
    { id: "active-child", isActive: true },
    { id: "inactive-child", isActive: false },
    { id: "inactive-standalone", isActive: false },
  ]);
});
