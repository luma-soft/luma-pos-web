import { readSource } from "../../test-support/read-source.mjs";
import { describe, expect, test } from "bun:test";

const consumers = [
  "../../app/(pos)/pos/pos-client.tsx",
  "../../app/(app)/purchases/new/purchase-form.tsx",
  "../../app/(app)/inventory/internal-use-form.tsx",
  "../../app/(app)/stocktakes/new/stocktake-form.tsx",
  "../../app/(app)/purchase-returns/new/purchase-return-form.tsx",
  "../../app/(app)/tables/[id]/table-order.tsx",
  "../../app/(app)/orders/[id]/edit/order-edit-form.tsx",
];
const stockSearchConsumers = [
  ...consumers,
  "../../app/(app)/inventory/tabs/shopee-listing-modal.tsx",
];
const scopeConsumers = [
  "../../app/(pos)/layout.tsx",
  "../../app/(app)/layout.tsx",
  "../../app/(pos)/pos/page.tsx",
  "../../lib/actions/product-catalog.ts",
  "../../lib/data/product-catalog.ts",
  "../../app/api/mobile/products/catalog/route.ts",
  "../../app/api/mobile/products/catalog/v2/route.ts",
];

describe("shared product search consumers", () => {
  test.each(consumers)("%s uses ProductSearchPicker", (path) => {
    const source = readSource(path, import.meta.url);
    expect(source).toContain("<ProductSearchPicker");
  });

  test.each(stockSearchConsumers)("%s keeps stock visible in product search results", (path) => {
    const source = readSource(path, import.meta.url);
    expect(source).toContain("ProductSearchStockLabel");
  });

  test("purchase keeps the picker open for multi-add", () => {
    const source = readSource(consumers[1], import.meta.url);
    expect(source).toContain("keepOpenOnSelect");
    expect(source).toContain("isItemSelected={(result) => lines.some");
  });

  test("all POS and inventory search consumers read the shared local catalog", () => {
    const pos = readSource(consumers[0], import.meta.url);
    expect(pos).toContain("const productCatalog = useProductCatalog()");
    expect(pos).toContain("searchProductCatalog(candidates, query");
    for (const path of consumers.slice(1)) {
      const source = readSource(path, import.meta.url);
      expect(source).toContain("catalog.search(query");
    }
  });

  test("stocktake and returns keep warehouse-aware stock mapping", () => {
    const stocktake = readSource(consumers[3], import.meta.url);
    const purchaseReturn = readSource(consumers[4], import.meta.url);
    expect(stocktake).toContain("getCatalogWarehouseStock(product, warehouseId)");
    expect(purchaseReturn).toContain("getCatalogWarehouseStock(product, warehouseId)");
  });

  test("numeric search consumers expose selected product quantity controls", () => {
    for (const path of consumers.slice(1, 5)) {
      const source = readSource(path, import.meta.url);
      expect(source).toContain("isItemSelected");
      expect(source).toContain("<QuantityInput");
    }
  });

  test("table ordering still enters its modifier flow", () => {
    const source = readSource(consumers[5], import.meta.url);
    expect(source).toContain("setPicker({ product: p, groups, unitName: selectedUnitName })");
  });

  test.each(scopeConsumers)("%s uses the canonical catalog scope", (path) => {
    const source = readSource(path, import.meta.url);
    expect(source).toContain("productCatalogScopeId");
  });

  test("POS tenant-local storage uses the same full scope as its catalog", () => {
    const source = readSource("../../app/(pos)/layout.tsx", import.meta.url);
    expect(source).toContain("const catalogScopeId = productCatalogScopeId(storeContext.storeId, user.id, role)");
    expect(source).toContain("<TenantClientScopeProvider scopeId={catalogScopeId}>");
    expect(source).not.toContain("const clientScopeId = `${user.id}:${role}`");
  });
});
