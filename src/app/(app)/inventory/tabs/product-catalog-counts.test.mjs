import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let totalProducts = 1584;
let totalCategories = 42;
let productCalls = [];
let categoryCalls = [];
const noop = () => null;
const translate = (key) => ({ "nav.products": "Sản phẩm", "categories.title": "Nhóm hàng" })[key] ?? key;
mock.module("next-intl", () => ({ useTranslations: () => translate, useLocale: () => "vi" }));
mock.module("next-intl/server", () => ({ getTranslations: async () => translate }));
mock.module("@/lib/auth/store-context", () => ({ requireStoreContext: async () => ({ storeId: "store-1", role: "owner" }) }));
mock.module("@/lib/data/products", () => ({
  getProduct: async () => null,
  getProducts: async (storeId, filters) => {
    productCalls.push({ storeId, filters });
    return { rows: totalProducts ? [{ id: "p1" }] : [], total: totalProducts, pageCount: Math.max(1, Math.ceil(totalProducts / 30)) };
  },
  getProductFormOptions: async () => ({
    categories: Array.from({ length: totalCategories }, (_, i) => ({ id: `c${i}`, name: `Nhóm ${i}` })),
    brands: [], suppliers: [], comboProducts: [],
  }),
}));
mock.module("@/lib/data/categories", () => ({
  getCategoriesWithCounts: async (storeId, filters) => {
    categoryCalls.push({ storeId, filters });
    return { rows: totalCategories ? [{ id: "c1", name: "Nhóm 1" }] : [], roots: [], total: totalCategories, pageCount: Math.max(1, Math.ceil(totalCategories / 15)) };
  },
}));
mock.module("@/lib/data/price-books", () => ({ getPriceBooks: async () => [], getPriceOverridesForProducts: async () => ({}) }));
mock.module("./products-table", () => ({ ProductsTable: noop }));
mock.module("../../products/new/product-form", () => ({ NewProductForm: noop }));
mock.module("../../products/product-form-values", () => ({ productToFormInitialValues: noop, resolveProductFormSeed: noop }));
mock.module("./shopee-listing-modal", () => ({ ShopeeListingModal: noop }));
mock.module("./camera-material-search", () => ({ CameraMaterialSearch: noop }));
mock.module("./instant-product-search", () => ({ InstantProductSearch: noop }));
mock.module("./inventory-filter-drawer", () => ({ InventoryFilterDrawer: noop }));
mock.module("./product-create-menu", () => ({ ProductCreateMenu: noop }));
mock.module("./product-selection", () => ({ ProductBulkActions: noop, ProductSelectionProvider: noop }));
mock.module("../../products/categories/categories-manager", () => ({ CategoriesManager: noop }));
mock.module("@/lib/media/config", () => ({ getPublicMediaConfig: noop }));

const { ProductsTab } = await import("./products.tsx");
const { ProductCatalogSwitcher } = await import("./product-catalog-switcher.tsx");

async function findSwitcher(element) {
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = await findSwitcher(child);
      if (found) return found;
    }
    return null;
  }
  if (!element?.props) return null;
  if (element.type === ProductCatalogSwitcher) return element.props;
  if (element.type?.name === "ProductsContent") return findSwitcher(await element.type(element.props));
  return findSwitcher(element.props.children);
}

beforeEach(() => {
  totalProducts = 1584;
  totalCategories = 42;
  productCalls = [];
  categoryCalls = [];
});

describe("product catalog tab counts", () => {
  test("product view supplies both totals, not the current page length", async () => {
    const props = await findSwitcher(await ProductsTab({ searchParams: { page: "2", size: "30" } }));
    expect(props).toMatchObject({ activeView: "products", productCount: 1584, categoryCount: 42 });
    expect(productCalls).toHaveLength(1);
    expect(productCalls[0]).toMatchObject({ storeId: "store-1", filters: { page: 2, pageSize: 30, view: "grouped", status: "active" } });
  });

  test("product count uses the same filtered total as pagination", async () => {
    totalProducts = 4;
    const props = await findSwitcher(await ProductsTab({ searchParams: { q: "2200", status: "all", view: "flat" } }));
    expect(props.productCount).toBe(4);
    expect(props.categoryCount).toBe(42);
    expect(productCalls[0].filters).toMatchObject({ q: "2200", status: "all", view: "flat" });
  });

  test("category view supplies both totals independently of category pagination", async () => {
    const props = await findSwitcher(await ProductsTab({ searchParams: { catalog: "categories", page: "2", size: "15" } }));
    expect(props).toMatchObject({ activeView: "categories", productCount: 1584, categoryCount: 42 });
    expect(categoryCalls[0]).toMatchObject({ storeId: "store-1", filters: { page: 2, pageSize: 15 } });
    expect(productCalls).toHaveLength(1);
    expect(productCalls[0]).toMatchObject({ storeId: "store-1", filters: { page: 1, view: "grouped", status: "active" } });
  });

  test("empty catalogs show zero for both tabs", async () => {
    totalProducts = 0;
    totalCategories = 0;
    const props = await findSwitcher(await ProductsTab({ searchParams: {} }));
    expect(props).toMatchObject({ productCount: 0, categoryCount: 0 });
    const html = renderToStaticMarkup(createElement(ProductCatalogSwitcher, props));
    expect(html.match(/>0<\/span>/g)).toHaveLength(2);
  });

  test("count labels use the active Vietnamese locale", () => {
    const html = renderToStaticMarkup(createElement(ProductCatalogSwitcher, { activeView: "products", productCount: 1584, categoryCount: 42 }));
    expect(html).toContain(">1.584</span>");
    expect(html).toContain(">42</span>");
    expect(html).toContain('aria-current="page"');
  });

  test("camera materials keep their dedicated view without catalog tabs", async () => {
    expect(await findSwitcher(await ProductsTab({ searchParams: { cameraMaterials: "1" } }))).toBeNull();
  });
});
