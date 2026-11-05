import { test, expect } from "bun:test";
import { isCatalogProductSellable } from "./product-catalog-adapter";

test("POS cannot offer inactive, draft or archived products from the full Inventory snapshot", () => {
  const create = (isActive, lifecycleStatus) => ({ isActive, lifecycleStatus });
  expect(isCatalogProductSellable(create(true, "active"))).toBe(true);
  expect(isCatalogProductSellable(create(false, "active"))).toBe(false);
  expect(isCatalogProductSellable(create(true, "inactive"))).toBe(false);
  expect(isCatalogProductSellable(create(false, "draft"))).toBe(false);
  expect(isCatalogProductSellable(create(true, "archived"))).toBe(false);
  expect(isCatalogProductSellable(create(undefined, "active"))).toBe(true);
  expect(isCatalogProductSellable(create(undefined, undefined))).toBe(true);
});
