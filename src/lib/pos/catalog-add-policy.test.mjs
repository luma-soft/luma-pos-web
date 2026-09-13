import { describe, expect, test } from "bun:test";
import { canAddCatalogProductsToPosDraft } from "./catalog-add-policy";

describe("POS catalog add policy", () => {
  test("blocks adding catalog products to an invoice return", () => {
    expect(canAddCatalogProductsToPosDraft("return_invoice")).toBe(false);
  });

  test("keeps quick returns and sales drafts open to catalog products", () => {
    expect(canAddCatalogProductsToPosDraft("return_quick")).toBe(true);
    expect(canAddCatalogProductsToPosDraft("invoice")).toBe(true);
  });
});
