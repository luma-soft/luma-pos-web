import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const pairedListSurfaces = [
  "src/app/(app)/partners/tabs/customers-table.tsx",
  "src/app/(app)/partners/tabs/suppliers-table.tsx",
  "src/app/(app)/sales/tabs/orders-filter-drawer.tsx",
  "src/app/(app)/sales/tabs/document-filter-drawer.tsx",
  "src/app/(app)/inventory/tabs/products.tsx",
  "src/app/(app)/inventory/tabs/pricing.tsx",
  "src/app/(app)/inventory/tabs/purchases.tsx",
  "src/app/(app)/inventory/tabs/purchase-returns.tsx",
  "src/app/(app)/inventory/tabs/internal-use.tsx",
  "src/app/(app)/inventory/tabs/stock.tsx",
];

describe("shared list search and filter", () => {
  test("all paired list toolbars use the shared layout", () => {
    for (const path of pairedListSurfaces) {
      expect(readFileSync(path, "utf8"), path).toContain("<ListSearchFilterBar");
    }
  });

  test("shared search and filter controls own the visual contract", () => {
    const source = readFileSync("src/components/list-search-filter.tsx", "utf8");

    expect(source).toContain("min-w-0 flex-1 lg:max-w-xl");
    expect(source).toContain("min-h-11 w-full rounded-xl");
    expect(source).toContain("border border-primary-600");
    expect(source).toContain("gap-2");
  });
});
