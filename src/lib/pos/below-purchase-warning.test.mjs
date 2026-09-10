import { expect, test } from "bun:test";
import { isSellPriceBelowPurchase, purchasePriceForSoldUnit } from "./below-purchase-warning";

const books = [{ id: "retail", systemType: "retail" }, { id: "purchase", systemType: "purchase" }];

test("resolves the latest net purchase price for the sold unit", () => {
  expect(purchasePriceForSoldUnit({ prices: { purchase: "65000" } }, books, 4)).toBe(260000);
});

test("returns no comparison when the role-filtered POS catalog hides purchase prices", () => {
  expect(purchasePriceForSoldUnit({ prices: {} }, [{ id: "retail", systemType: "retail" }], 1)).toBeNull();
});

test("warns only when the final selling price is strictly below purchase", () => {
  expect(isSellPriceBelowPurchase(64999, 65000)).toBe(true);
  expect(isSellPriceBelowPurchase(65000, 65000)).toBe(false);
  expect(isSellPriceBelowPurchase(0, null)).toBe(false);
});
