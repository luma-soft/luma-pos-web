import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const consumers = [
  "../../app/(pos)/pos/pos-client.tsx",
  "../../app/(app)/purchases/new/purchase-form.tsx",
  "../../app/(app)/inventory/internal-use-form.tsx",
  "../../app/(app)/stocktakes/new/stocktake-form.tsx",
  "../../app/(app)/purchase-returns/new/purchase-return-form.tsx",
  "../../app/(app)/tables/[id]/table-order.tsx",
  "../../app/(app)/orders/[id]/edit/order-edit-form.tsx",
];

describe("shared product search consumers", () => {
  test.each(consumers)("%s uses ProductSearchPicker", (path) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).toContain("<ProductSearchPicker");
  });

  test("purchase keeps the picker open for multi-add", () => {
    const source = readFileSync(new URL(consumers[1], import.meta.url), "utf8");
    expect(source).toContain("keepOpenOnSelect");
    expect(source).toContain("excludeIds: selectedProductIds");
  });

  test("stocktake and returns keep warehouse-aware stock mapping", () => {
    const stocktake = readFileSync(new URL(consumers[3], import.meta.url), "utf8");
    const purchaseReturn = readFileSync(new URL(consumers[4], import.meta.url), "utf8");
    expect(stocktake).toContain("getCatalogWarehouseStock(product, warehouseId)");
    expect(purchaseReturn).toContain("getCatalogWarehouseStock(product, warehouseId)");
  });

  test("table ordering still enters its modifier flow", () => {
    const source = readFileSync(new URL(consumers[5], import.meta.url), "utf8");
    expect(source).toContain("setPicker({ product: p, groups })");
  });
});
