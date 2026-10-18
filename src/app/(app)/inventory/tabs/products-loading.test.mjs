import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const inventoryPage = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const productsTab = readFileSync(new URL("./products.tsx", import.meta.url), "utf8");

test("product tab keeps its shell while server data is loading", () => {
  const suspenseStart = inventoryPage.indexOf(
    "<Suspense fallback={<ProductsTabLoading />}>",
  );
  const suspenseEnd = inventoryPage.indexOf("</Suspense>", suspenseStart);
  const suspense = inventoryPage.slice(suspenseStart, suspenseEnd);

  expect(suspenseStart).toBeGreaterThan(-1);
  expect(suspenseEnd).toBeGreaterThan(suspenseStart);
  expect(suspense).toContain("{tabContent}");
  expect(inventoryPage).toContain(
    'tab === "products" && !effectiveParams.productModal && effectiveParams.catalog !== "categories"',
  );
  expect(productsTab).toContain("export function ProductsTabLoading()");
  expect(productsTab).toContain("<TableSkeleton cols={8} rows={10} />");
});
