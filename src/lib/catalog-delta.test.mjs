import { expect, test } from "bun:test";
import { changedCatalogProductIds, replayCatalogDeltaBatch } from "./catalog-delta";

const event = (revision, productId, requiresFull = false) =>
  ({ revision, productId, requiresFull });

test("replays updates and hard deletions as one deduplicated set of IDs", () => {
  expect(changedCatalogProductIds(12, 16, [
    event(13, "product-a"),
    event(14, "product-b"), // hard delete tombstone
    event(15, "product-a"), // price edit
    event(16, "product-c"), // stock edit
  ])).toEqual(["product-a", "product-b", "product-c"]);
});

test("rejects gaps, old and overlapping revision windows", () => {
  expect(changedCatalogProductIds(20, 23, [
    event(21, "p"), event(23, "q"),
  ])).toBeNull();
  expect(changedCatalogProductIds(20, 22, [
    event(21, "p"), event(22, "q"), event(23, "r"),
  ])).toBeNull();
  expect(changedCatalogProductIds(22, 22, [])).toBeNull();
});

test("global invalidation and missing tombstone product ID force full", () => {
  expect(changedCatalogProductIds(1, 3, [
    event(2, "p"), event(3, null, true),
  ])).toBeNull();
  expect(changedCatalogProductIds(1, 2, [event(2, null)])).toBeNull();
});

test("oversized delta returns full snapshot instead of partial patch", () => {
  const events = Array.from({ length: 301 }, (_, index) =>
    event(index + 2, `product-${index}`));
  expect(changedCatalogProductIds(1, 302, events)).toBeNull();
});

test("V2 coalesces targeted product and metadata changes into a bounded batch", () => {
  const batch = replayCatalogDeltaBatch(40, 45, [
    { revision: 41, changeKind: "stock", entityType: "stock_levels", entityId: "stock-1", affectedProductIds: ["p1"], requiresFullV2: false },
    { revision: 42, changeKind: "price", entityType: "product_prices", entityId: "price-1", affectedProductIds: ["p1"], requiresFullV2: false },
    { revision: 43, changeKind: "metadata", entityType: "categories", entityId: "c1", affectedProductIds: [], requiresFullV2: false },
    { revision: 44, changeKind: "unit", entityType: "product_units", entityId: "unit-1", affectedProductIds: ["p2"], requiresFullV2: false },
    { revision: 45, changeKind: "metadata", entityType: "suppliers", entityId: "s1", affectedProductIds: [], requiresFullV2: false },
  ]);
  expect(batch).toEqual({
    fromRevision: "40",
    toRevision: "45",
    productIds: ["p1", "p2"],
    metadataIds: { categories: ["c1"], suppliers: ["s1"] },
    hasMore: false,
  });
});

test("V2 does not publish incomplete or unstructured revision ranges", () => {
  expect(replayCatalogDeltaBatch(10, 12, [
    { revision: 11, changeKind: "stock", entityType: "stock_levels", entityId: "s", affectedProductIds: ["p"], requiresFullV2: false },
    { revision: 12, changeKind: null, entityType: null, entityId: null, affectedProductIds: null, requiresFullV2: false },
  ])).toBeNull();
  expect(replayCatalogDeltaBatch(10, 12, [
    { revision: 12, changeKind: "price", entityType: "product_prices", entityId: "x", affectedProductIds: ["p"], requiresFullV2: false },
  ])).toBeNull();
  expect(replayCatalogDeltaBatch(10, 12, [
    { revision: 11, changeKind: "reset", entityType: null, entityId: null, affectedProductIds: [], requiresFullV2: true },
  ])).toBeNull();
});

test("V2 returns a complete bounded page and advances only to the last applied revision", () => {
  const events = Array.from({ length: 3 }, (_, index) => ({
    revision: index + 21,
    changeKind: "stock",
    entityType: "stock_levels",
    entityId: `s${index}`,
    affectedProductIds: [`p${index}`],
    requiresFullV2: false,
  }));
  expect(replayCatalogDeltaBatch(20, 24, events, 2)).toEqual({
    fromRevision: "20",
    toRevision: "22",
    productIds: ["p0", "p1"],
    metadataIds: {},
    hasMore: true,
  });
});
