import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let catalog;
const translate = (key) => ({ "nav.products": "Sản phẩm", "categories.title": "Nhóm hàng" })[key] ?? key;

mock.module("next-intl", () => ({ useTranslations: () => translate, useLocale: () => "vi" }));
mock.module("next/link", () => ({
  default: ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
}));
mock.module("@/components/product-catalog-provider", () => ({ useProductCatalog: () => catalog }));

const { ProductCatalogSwitcher } = await import("./product-catalog-switcher.tsx");

function product(overrides = {}) {
  return {
    id: "product-1",
    sku: "SKU-1",
    barcode: null,
    name: "Sản phẩm mẫu",
    productKind: "product",
    isActive: true,
    lifecycleStatus: "active",
    categoryId: null,
    brandId: null,
    supplierId: null,
    supplierIDs: [],
    parentProductId: null,
    relatedProductId: null,
    variantGroupId: null,
    variantGroupKind: null,
    isVariantParent: false,
    warehouseStock: [],
    retailPrice: "20",
    costPrice: "10",
    lastPurchaseNetPrice: "10",
    priceBookTypes: {},
    prices: {},
    minStock: "0",
    specs: {},
    comboItems: [],
    units: [],
    baseUnit: "cái",
    baseUnitDirectSale: true,
    priceByWeight: false,
    isStockManaged: true,
    imageUpdatedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderSwitcher(props = {}) {
  return renderToStaticMarkup(createElement(ProductCatalogSwitcher, { activeView: "products", ...props }));
}

beforeEach(() => {
  catalog = {
    products: [],
    snapshot: { warehouses: [], metadata: { categories: [], brands: [], suppliers: [] } },
  };
});

describe("product catalog tab counts", () => {
  test("product count comes from all active local inventory groups", () => {
    const groupRoot = product({ id: "group-root", sku: "GROUP", isVariantParent: true });
    const groupMember = product({ id: "group-member", sku: "GROUP-1", variantGroupId: "group-root", variantGroupKind: "native" });
    const standalone = product({ id: "standalone", sku: "SINGLE" });
    const inactive = product({ id: "inactive", sku: "OLD", isActive: false, lifecycleStatus: "archived" });
    catalog.products = [groupRoot, groupMember, standalone, inactive];

    const html = renderSwitcher();

    expect(html).toContain(">2</span>");
    expect(html).toContain('aria-current="page"');
  });

  test("category count uses the supplied total while product count stays local", () => {
    catalog.products = [product()];

    const html = renderSwitcher({ activeView: "categories", productCount: undefined, categoryCount: 42 });

    expect(html).toContain(">1</span>");
    expect(html).toContain(">42</span>");
    expect(html).toContain('href="/inventory?tab=products&amp;catalog=categories"');
    expect(html).toContain('aria-current="page"');
  });

  test("category count falls back to locally cached catalog metadata", () => {
    catalog.snapshot.metadata.categories = [{ id: "c1", name: "Nhóm 1" }, { id: "c2", name: "Nhóm 2" }];

    const html = renderSwitcher();

    expect(html).toContain(">0</span>");
    expect(html).toContain(">2</span>");
  });

  test("counts use the active Vietnamese locale", () => {
    const html = renderSwitcher({ productCount: 1584, categoryCount: 42 });

    expect(html).toContain(">1.584</span>");
    expect(html).toContain(">42</span>");
  });
});
