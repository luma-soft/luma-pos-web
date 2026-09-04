import { beforeEach, describe, expect, mock, test } from "bun:test";

let role = "owner";
let bookOptions;
let productFilters;
let productRows;
const books = [
  { id: "retail", name: "Giá chung", systemType: "retail", isDefault: true, managerOnly: false, sortOrder: 0 },
  { id: "cost", name: "Giá vốn", systemType: "cost", isDefault: false, managerOnly: true, sortOrder: 1 },
  { id: "purchase", name: "Giá nhập cuối", systemType: "purchase", isDefault: false, managerOnly: true, sortOrder: 2 },
  { id: "list", name: "Giá chưa chiết khấu", systemType: "list", isDefault: false, managerOnly: false, sortOrder: 3 },
  { id: "trade", name: "Giá thợ", systemType: null, isDefault: false, managerOnly: false, sortOrder: 4 },
];
const product = { id: "p1", sku: "SP001", name: "Ống nhựa", baseUnit: "m", costPrice: 90000, lastPurchasePrice: 100000, lastPurchaseNetPrice: null, baseRetailPrice: 120000 };
const overrides = { retail: { p1: "9" }, cost: { p1: "8" }, purchase: { p1: "7" }, list: { p1: "140000" }, trade: { p1: "110000" } };

mock.module("@/lib/auth/store-context", () => ({ requireStoreContext: async () => ({ storeId: "store-1", role }) }));
mock.module("@/lib/data/price-books", () => ({
  getPriceBooks: async (_storeId, options) => {
    bookOptions = options;
    return options?.includeManagerOnly === false ? books.filter((book) => !book.managerOnly) : books;
  },
  getPriceOverridesForProducts: async () => overrides,
}));
mock.module("@/lib/data/products", () => ({
  getProductFormOptions: async () => ({ categories: [], brands: [], suppliers: [] }),
}));
mock.module("@/lib/data/pricing", () => ({
  getPricingPage: async (_storeId, filters) => {
    productFilters = filters;
    return { rows: productRows, total: productRows.length, pageCount: 1 };
  },
}));
mock.module("next-intl/server", () => ({ getTranslations: async () => (key) => key }));
mock.module("./inventory-filter-drawer", () => ({ InventoryFilterDrawer: () => null }));
mock.module("@/lib/actions/price-books", () => ({
  createPriceBook: async () => ({ ok: false }),
  renamePriceBook: async () => ({ ok: false }),
  deletePriceBook: async () => ({ ok: false }),
  setProductPrice: async () => ({ ok: false }),
  applyPriceFormulaAll: async () => ({ ok: false }),
}));

const { PricingTab, inventoryPricingFilters } = await import("./pricing.tsx");
const { PricingTable } = await import("../../pricing/pricing-table.tsx");

async function clientTable(searchParams = {}) {
  const tab = await PricingTab({ searchParams });
  const content = tab.props.children.props.children;
  const rendered = await content.type(content.props);
  return rendered.props.children.find((child) => child?.type === PricingTable);
}

async function clientProps(searchParams = {}) {
  return (await clientTable(searchParams)).props;
}

beforeEach(() => {
  role = "owner";
  product.lastPurchaseNetPrice = null;
  productRows = [product];
  overrides.list.p1 = "140000";
  overrides.trade.p1 = "110000";
});

describe("pricing server-to-client data", () => {
  test("passes fixed, zero and linked unit prices to the confirmation boundary", async () => {
    productRows = [{ ...product, units: [
      { id: "cay", unitName: "Cây", multiplier: 4, priceOverride: 60000 },
      { id: "bo", unitName: "Bó", multiplier: 20, priceOverride: null },
      { id: "mau", unitName: "Mẫu", multiplier: 0.25, priceOverride: 0 },
    ] }];
    expect((await clientProps()).rows[0].units).toEqual([
      { id: "cay", unitName: "Cây", multiplier: 4, priceOverride: 60000 },
      { id: "bo", unitName: "Bó", multiplier: 20, priceOverride: null },
      { id: "mau", unitName: "Mẫu", multiplier: 0.25, priceOverride: 0 },
    ]);
  });

  test("price revalidation preserves the table identity and scroll reset key", async () => {
    const before = await clientTable({ page: "2", q: "Ống" });
    overrides.list.p1 = "150000";
    productRows = [{ ...product, baseRetailPrice: 130000 }];
    const after = await clientTable({ page: "2", q: "Ống" });
    expect(after.props.rows[0].prices.list).toBe(150000);
    expect(after.props.rows[0].prices.retail).toBe(130000);
    expect(after.key).toBe(before.key);
    expect(after.props.resetScrollKey).toBe(before.props.resetScrollKey);
  });

  test("a new page or filter still resets the result set", async () => {
    const before = await clientTable({ page: "2", q: "Ống" });
    for (const params of [{ page: "3", q: "Ống" }, { page: "2", q: "Dây" }]) {
      const after = await clientTable(params);
      expect(after.key).not.toBe(before.key);
      expect(after.props.resetScrollKey).not.toBe(before.props.resetScrollKey);
    }
  });

  test("cost, net purchase and retail use product sources while company catalogue uses its own override", async () => {
    const props = await clientProps();
    expect(props.rows[0].prices).toEqual({ retail: 120000, cost: 90000, purchase: null, list: 140000, trade: 110000 });
    expect(props.rows[0].lastPurchase).toBeNull();
    expect(props.canViewPurchasePrices).toBe(true);
  });

  test("zero purchase price survives the server boundary", async () => {
    product.lastPurchaseNetPrice = "0";
    const props = await clientProps();
    expect(props.rows[0].prices.purchase).toBe(0);
    expect(props.rows[0].lastPurchase).toBe(0);
  });

  test("missing company catalogue is explicit and does not inherit historical gross purchase or retail", async () => {
    delete overrides.list.p1;
    const props = await clientProps();
    expect(props.rows[0].prices.list).toBeNull();
    expect(props.rows[0].prices.purchase).toBeNull();
  });

  test("pricing requests individual SKUs and preserves search and filters", async () => {
    productRows = [
      { ...product, id: "rap-e", sku: "RAP2200(E)", name: "Ruijie RAP2200(E)", baseRetailPrice: 1490000 },
      { ...product, id: "rap-f", sku: "RAP2200(F)", name: "Ruijie RAP2200(F)", baseRetailPrice: 1190000 },
    ];
    const category = "11111111-1111-4111-8111-111111111111", brand = "22222222-2222-4222-8222-222222222222";
    const props = await clientProps({ q: "2200", category, brandId: brand, status: "active" });
    expect(productFilters).toMatchObject({ q: "2200", categoryIds: [category], brandIds: [brand], lifecycle: "active" });
    const { page, pageSize, sort, ...listingFilters } = productFilters;
    expect(props.filters).toEqual(listingFilters);
    expect(props.rows.map((row) => [row.id, row.sku, row.name, row.prices.retail])).toEqual([
      ["rap-e", "RAP2200(E)", "Ruijie RAP2200(E)", 1490000],
      ["rap-f", "RAP2200(F)", "Ruijie RAP2200(F)", 1190000],
    ]);
    expect(props.total).toBe(2);
  });

  test("custom books retain an empty override for the retail placeholder", async () => {
    delete overrides.trade.p1;
    expect((await clientProps()).rows[0].prices.trade).toBeNull();
  });

  test("pagination never changes the bulk predicate and aliases stay explicit", async () => {
    const params = { q: "Ống C3", status: "inactive", stock: "instock", productKind: "product" };
    const first = await clientProps({ ...params, page: "1" });
    const last = await clientProps({ ...params, page: "9" });
    expect(first.filters).toEqual(last.filters);
    expect(first.filters).toMatchObject({ q: "Ống C3", lifecycle: "paused", stock: "available", productKind: "product" });
    expect(inventoryPricingFilters({ stock: "low" }).stock).toBe("lowStock");
    expect(inventoryPricingFilters({ stock: "out" }).stock).toBe("outOfStock");
    expect(inventoryPricingFilters({ status: "all" }).lifecycle).toBe("all");
    expect(() => inventoryPricingFilters({ category: "invalid-id" })).toThrow();
    expect(() => inventoryPricingFilters({ stock: "overStock" })).toThrow();
  });

  test.each(["owner", "manager"])("%s can see purchase sources", async (allowedRole) => {
    role = allowedRole;
    product.lastPurchaseNetPrice = "65000";
    const props = await clientProps();
    expect(bookOptions).toEqual({ includeManagerOnly: true });
    expect(props.rows[0].prices.purchase).toBe(65000);
    expect(props.rows[0].costPrice).toBe(90000);
  });

  test.each(["cashier", "warehouse"])("%s receives neither internal books nor purchase sources", async (restrictedRole) => {
    role = restrictedRole;
    product.lastPurchaseNetPrice = "65000";
    const props = await clientProps();
    expect(bookOptions).toEqual({ includeManagerOnly: false });
    expect(props.books.map((book) => book.id)).toEqual(["list", "retail", "trade"]);
    expect(props.rows[0].prices).toEqual({ retail: 120000, list: 140000, trade: 110000 });
    expect(props.rows[0].costPrice).toBeNull();
    expect(props.rows[0].lastPurchase).toBeNull();
    expect(props.canViewPurchasePrices).toBe(false);
  });
});
