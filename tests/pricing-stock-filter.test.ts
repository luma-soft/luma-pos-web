import { describe, expect, test } from "bun:test";
import { matchesPricingStockFilter } from "../src/lib/data/pricing-stock";

describe("pricing stock filters", () => {
  const minStock = 5;

  test.each([
    ["negativeStock", -1, true],
    ["negativeStock", 0, false],
    ["outOfStock", -1, false],
    ["outOfStock", 0, true],
    ["lowStock", 1, true],
    ["lowStock", minStock - 1, true],
    ["lowStock", minStock, false],
    ["inStock", minStock - 1, false],
    ["inStock", minStock, true],
  ] as const)("%s classifies stock %d", (filter, stock, expected) => {
    expect(matchesPricingStockFilter(filter, stock, minStock)).toBe(expected);
  });
});
