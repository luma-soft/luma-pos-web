import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PRODUCT_LIST_SORT,
  parseProductListSort,
} from "@/lib/inventory/product-list-policy";

describe("product list default sort", () => {
  test("defaults missing and invalid values to the most recently updated products", () => {
    expect(DEFAULT_PRODUCT_LIST_SORT).toBe("updated");
    expect(parseProductListSort(undefined)).toBe("updated");
    expect(parseProductListSort("unsupported")).toBe("updated");
  });

  test("preserves explicit supported sort choices", () => {
    expect(parseProductListSort("name")).toBe("name");
    expect(parseProductListSort("stock")).toBe("stock");
    expect(parseProductListSort("updated")).toBe("updated");
  });

  test("wires the default into product loading and the product filter drawer", () => {
    const productsTab = readFileSync(
      "src/app/(app)/inventory/tabs/products.tsx",
      "utf8",
    );
    const filterDrawer = readFileSync(
      "src/app/(app)/inventory/tabs/inventory-filter-drawer.tsx",
      "utf8",
    );
    const productsData = readFileSync("src/lib/data/products.ts", "utf8");

    expect(productsTab).toContain("defaultSort={DEFAULT_PRODUCT_LIST_SORT}");
    expect(productsTab).toContain("sort: parseProductListSort(params.sort)");
    expect(filterDrawer).toContain("sort: values.sort ?? defaultSort");
    expect(filterDrawer).toContain('sort: defaultSort,');
    expect(productsData).toContain(
      "sort: filters.sort ?? DEFAULT_PRODUCT_LIST_SORT",
    );
  });
});
