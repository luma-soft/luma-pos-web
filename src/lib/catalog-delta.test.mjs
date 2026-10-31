import { expect, test } from "bun:test";
import { changedCatalogProductIds } from "./catalog-delta";

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
