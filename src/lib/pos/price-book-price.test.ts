import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { posBasePrice, posUnitPrice } from "./price-book-price";

const books = [
  { id: "retail", systemType: "retail" as const, isDefault: true },
  { id: "cost", systemType: "cost" as const },
  { id: "purchase", systemType: "purchase" as const },
];
const product = {
  retailPrice: "1490000",
  prices: { retail: "7", cost: "1000000", purchase: "1200000" },
  priceBookTypes: { retail: "retail" as const, cost: "cost" as const, purchase: "purchase" as const },
};

describe("POS automatic price books", () => {
  it("selects retail, cost and gross purchase prices from their sources", () => {
    assert.equal(posBasePrice(product, "retail", books), 1490000);
    assert.equal(posBasePrice(product, "cost", books), 1000000);
    assert.equal(posBasePrice(product, "purchase", books), 1200000);
  });

  it("missing gross purchase price is unavailable, with no retail fallback", () => {
    const missing = { ...product, prices: { ...product.prices, purchase: null } };
    assert.equal(posBasePrice(missing, "purchase", books), null);
    assert.equal(posUnitPrice(missing, { multiplier: "10", priceOverride: "12900000" }, "purchase", books), null);
  });

  it("a legitimate zero source is available in both purchase books", () => {
    const free = { ...product, prices: { ...product.prices, cost: "0", purchase: "0" } };
    assert.equal(posBasePrice(free, "cost", books), 0);
    assert.equal(posBasePrice(free, "purchase", books), 0);
    assert.equal(posUnitPrice(free, { multiplier: "10", priceOverride: "12900000" }, "cost", books), 0);
  });

  it("converts cost and gross by unit multiplier while preserving retail unit override", () => {
    const unit = { multiplier: "10", priceOverride: "12900000" };
    assert.equal(posUnitPrice(product, unit, "retail", books), 12900000);
    assert.equal(posUnitPrice(product, unit, "cost", books), 10000000);
    assert.equal(posUnitPrice(product, unit, "purchase", books), 12000000);
  });

  it("rejects a book absent from the permitted book list", () => {
    assert.equal(posBasePrice(product, "cost", [books[0]]), null);
    assert.equal(posUnitPrice(product, null, "purchase", [books[0]]), null);
  });

  it("uses projected source types when no book list is supplied", () => {
    assert.equal(posBasePrice(product, "cost"), 1000000);
    assert.equal(posUnitPrice(product, { multiplier: "10", priceOverride: "12900000" }, "purchase"), 12000000);
  });
});
