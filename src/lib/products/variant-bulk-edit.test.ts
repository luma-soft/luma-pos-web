import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bulkAdjustedPrice, isValidBulkPriceInput, variantRowMatches } from "./variant-bulk-edit";

describe("variant bulk edit", () => {
  it("sets, scales and shifts prices in whole đồng without going negative", () => {
    assert.equal(bulkAdjustedPrice(120000, "set", 150000), 150000);
    assert.equal(bulkAdjustedPrice("200000.00", "percent", 10), 220000);
    assert.equal(bulkAdjustedPrice(99999, "percent", -5), 94999);
    assert.equal(bulkAdjustedPrice(50000, "amount", -60000), 0);
    assert.equal(bulkAdjustedPrice(null, "amount", 5000), 5000);
  });

  it("rejects inputs that would do nothing or wipe prices by accident", () => {
    assert.equal(isValidBulkPriceInput("set", 0), true);
    assert.equal(isValidBulkPriceInput("set", -1), false);
    assert.equal(isValidBulkPriceInput("percent", 0), false);
    assert.equal(isValidBulkPriceInput("percent", -100), false);
    assert.equal(isValidBulkPriceInput("amount", Number.NaN), false);
  });

  it("filters rows by label, SKU and saved status", () => {
    const row = { variantName: "Ø27 / Trắng", sku: "ONG-27", persisted: true };
    assert.equal(variantRowMatches(row, "27 trang", "all"), true);
    assert.equal(variantRowMatches(row, "ong-27", "existing"), true);
    assert.equal(variantRowMatches(row, "", "new"), false);
    assert.equal(variantRowMatches(row, "Ø34", "all"), false);
  });
});
