import { readSource } from "../../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const inventoryPage = readSource("../page.tsx", import.meta.url);
const productsTab = readSource("./products.tsx", import.meta.url);
const catalog = readSource("./product-catalog-products-content.tsx", import.meta.url);
const skeleton = readSource("../../../../components/mobile-inventory-catalog-skeleton.tsx", import.meta.url);

test("product tab keeps one consistent shell from streaming through cache restore", () => {
  expect(inventoryPage).toContain("<Suspense fallback={<ProductsTabLoading />}>");
  expect(productsTab).toContain("export function ProductsTabLoading()");
  expect(productsTab).toContain("return <MobileInventoryCatalogSkeleton />");
  expect(productsTab).toContain("fallback={<MobileInventoryCatalogSkeleton />}");
  expect(catalog).toContain('if (catalog.status === "loading") return <MobileInventoryCatalogSkeleton />');
});
test("mobile loader uses the native product browse skeleton without a desktop regression", () => {
  expect(skeleton).toContain("<MobileProductListSkeleton");
  expect(skeleton).toContain('className="hidden lg:block"');
  expect(skeleton).toContain("<DesktopTableSkeleton cols={8} rows={10} />");
});
