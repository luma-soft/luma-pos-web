import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("bulk product actions route every selected product into purchase and POS drafts", () => {
  const actions = source("./product-selection.tsx");
  const routes = source("../../../../lib/routes.ts");
  const purchasePage = source("../../purchases/new/page.tsx");
  const posPage = source("../../../(pos)/pos/page.tsx");

  expect(actions).toContain("Routes.purchaseNewForProducts(ids)");
  expect(actions).toContain('openPos("invoice")');
  expect(actions).toContain('openPos("booking")');
  expect(actions).toContain('openPos("return_quick")');
  expect(actions).toContain('openPos("quote")');
  expect(routes).toContain("purchaseNewForProducts");
  expect(routes).toContain("posForProducts");
  expect(purchasePage).toContain("sp.productIds");
  expect(purchasePage).toContain("getPurchaseProductRowsByIds");
  expect(posPage).toContain("params.productIds");
  expect(posPage).toContain("bulkItems");
});
