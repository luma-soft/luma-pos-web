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
  expect(purchasePage).toContain("const seen = new Set<string>()");
  expect(purchasePage).toContain("const orderedInitialProducts = seedProductIds.flatMap");
  expect(posPage).toContain("params.productIds");
  expect(posPage).toContain("bulkItems");
});

test("bulk menu offers resume for inactive products and both actions for mixed selection", () => {
  const actions = source("./product-selection.tsx");
  const catalog = source("./product-catalog-products-content.tsx");
  const mutations = source("../../../../lib/actions/products.ts");
  const mobileRoute = source("../../../api/mobile/products/bulk/route.ts");

  expect(actions).toContain("activeSelectedIds.length > 0");
  expect(actions).toContain("inactiveSelectedIds.length > 0");
  expect(actions).toContain("bulkResumeSellingProducts(targetIds)");
  expect(actions).toContain("bulkStopSellingProducts(targetIds)");
  expect(actions).toContain("await catalog.refresh()");
  expect(catalog).toContain("visibleProductSelections(result.rows");
  expect(mutations).toContain("row.isActive !== isActive");
  expect(mutations).toContain("export async function bulkResumeSellingProducts(");
  expect(mobileRoute).toContain('z.enum(["stop", "resume", "delete"])');
  expect(mobileRoute).toContain("bulkResumeSellingProducts(ids)");
});
