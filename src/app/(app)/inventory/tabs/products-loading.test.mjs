import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const inventoryPage = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const productsTab = readFileSync(new URL("./products.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("./product-catalog-products-content.tsx", import.meta.url), "utf8");
const skeleton = readFileSync(new URL("../../../../components/mobile-inventory-catalog-skeleton.tsx", import.meta.url), "utf8");

test("product tab keeps one consistent shell from streaming through cache restore", () => {
  expect(inventoryPage).toContain("<Suspense fallback={<ProductsTabLoading />}>");
  expect(productsTab).toContain("export function ProductsTabLoading()");
  expect(productsTab).toContain("return <MobileInventoryCatalogSkeleton />");
  expect(productsTab).toContain("fallback={<MobileInventoryCatalogSkeleton />}");
  expect(catalog).toContain('if (catalog.status === "loading") return <MobileInventoryCatalogSkeleton />');
});
test("mobile loader matches product row geometry without a desktop regression", () => {
  expect(skeleton).toContain('className="space-y-3 lg:hidden"');
  expect(skeleton).toContain("min-h-[94px]");
  expect(skeleton).toContain("h-16 w-16");
  expect(skeleton).toContain('className="hidden lg:block"');
  expect(skeleton).toContain("<TableSkeleton cols={8} rows={10} />");
});
