import { describe, expect, test } from "bun:test";
import { searchProductCatalog } from "./product-catalog";
import { matchesProductVariant } from "./products/variant-presentation";

const product = (id, name, overrides = {}) => ({
  id, name, sku: `SKU-${id}`, barcode: null, units: [], isStockManaged: true, ...overrides,
});

const elbow = product("27", "Cút góc - 27", { barcode: "8934567890123" });
const other = product("99", "Cút góc - 99");
const catalog = [elbow, other];

describe("product catalog keyword search", () => {
  test("matches separated, reordered and accent-insensitive words", () => {
    for (const query of ["cút 27", "cút góc 27", "27 CUT", "cút góc 27", "cút-góc 27", "  CÚT   27  "]) {
      expect(searchProductCatalog(catalog, query).map((item) => item.id)).toEqual(["27"]);
      expect(matchesProductVariant(elbow, query)).toBe(true);
    }
  });

  test("Vietnamese tone placement and decomposed stored characters agree", () => {
    const rows = [product("tone", "Òa úy".normalize("NFD"))];
    for (const query of ["Òa úy", "oà uý", "OA UY", "uy oa"]) {
      expect(searchProductCatalog(rows, query).map((item) => item.id)).toEqual(["tone"]);
    }
  });

  test("keywords must all belong to the same product; empty/punctuation do not return all", () => {
    expect(searchProductCatalog(catalog, "cút 28")).toEqual([]);
    expect(searchProductCatalog(catalog, "27 99")).toEqual([]);
    expect(searchProductCatalog(catalog, "")).toEqual([]);
    expect(searchProductCatalog(catalog, "% _ -")).toEqual([]);
  });

  test("preserves SKU, barcode and alternate-unit lookup with cross-field keywords", () => {
    for (const query of ["SKU-27", "8934567890123", "góc SKU-27"]) {
      expect(searchProductCatalog(catalog, query).map((item) => item.id)).toEqual(["27"]);
    }
    const rows = [product("unit", "Ống", { units: [{ unitName: "Cuộn", multiplier: "10", barcode: "UNIT-001", priceOverride: null }] })];
    expect(searchProductCatalog(rows, "ống UNIT-001").map((item) => item.id)).toEqual(["unit"]);
  });

  test("finds variants by their variant label and specification values", () => {
    const rows = [product("variant", "Gạch Lâm Hưng sân vườn", {
      variantName: "34601",
      specs: { "Phiên bản": ["34601"], "Kích thước": ["40x60"] },
    })];
    expect(searchProductCatalog(rows, "34601").map((item) => item.id)).toEqual(["variant"]);
    expect(searchProductCatalog(rows, "40x60").map((item) => item.id)).toEqual(["variant"]);
  });

  test("respects exclusions, stock-managed filtering and limit", () => {
    expect(searchProductCatalog(catalog, "cút", { excludeIds: new Set(["27"]) }).map((item) => item.id)).toEqual(["99"]);
    expect(searchProductCatalog(catalog, "cút", { limit: 1 }).map((item) => item.id)).toEqual(["27"]);
    expect(searchProductCatalog([product("service", "Cút", { isStockManaged: false })], "cút", { stockManagedOnly: true })).toEqual([]);
  });
});
