import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { posBasePrice, posUnitPrice } from "./price-book-price";

const books = [
  { id: "retail", systemType: "retail" as const, isDefault: true },
  { id: "cost", systemType: "cost" as const },
  { id: "purchase", systemType: "purchase" as const },
  { id: "list", systemType: "list" as const },
];
const product = {
  retailPrice: "1490000",
  prices: { retail: "7", cost: "1000000", purchase: "1200000", list: "1800000" },
  priceBookTypes: { retail: "retail" as const, cost: "cost" as const, purchase: "purchase" as const, list: "list" as const },
};

describe("POS automatic price books", () => {
  it("selects retail, cost, net purchase and catalogue prices from their sources", () => {
    assert.equal(posBasePrice(product, "retail", books), 1490000);
    assert.equal(posBasePrice(product, "cost", books), 1000000);
    assert.equal(posBasePrice(product, "purchase", books), 1200000);
    assert.equal(posBasePrice(product, "list", books), 1800000);
  });

  it("missing net purchase price is unavailable, with no retail fallback", () => {
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

  it("converts cost, net purchase and catalogue by multiplier while preserving retail unit override", () => {
    const unit = { multiplier: "10", priceOverride: "12900000" };
    assert.equal(posUnitPrice(product, unit, "retail", books), 12900000);
    assert.equal(posUnitPrice(product, unit, "cost", books), 10000000);
    assert.equal(posUnitPrice(product, unit, "purchase", books), 12000000);
    assert.equal(posUnitPrice(product, unit, "list", books), 18000000);
  });

  it("missing catalogue prices do not inherit retail or retail unit overrides", () => {
    const missing = { ...product, prices: { ...product.prices, list: null } };
    assert.equal(posBasePrice(missing, "list", books), null);
    assert.equal(posUnitPrice(missing, { multiplier: "10", priceOverride: "12900000" }, "list", books), null);
    const absent = { ...product, prices: { retail: "1490000" } };
    assert.equal(posBasePrice(absent, "list", books), null);
  });

  it("an explicit zero catalogue price survives unit conversion", () => {
    const free = { ...product, prices: { ...product.prices, list: "0" } };
    assert.equal(posUnitPrice(free, { multiplier: "10", priceOverride: "12900000" }, "list", books), 0);
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
