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
const product = { id: "p1", sku: "SP001", name: "Ống nhựa", baseUnit: "m", costPrice: "90000", lastPurchasePrice: "100000", lastPurchaseNetPrice: null, retailPrice: "120000" };
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
  getProducts: async (_storeId, filters) => {
    productFilters = filters;
    return { rows: productRows, total: productRows.length, pageCount: 1 };
  },
  getProductFormOptions: async () => ({ categories: [], brands: [], suppliers: [] }),
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

const { PricingTab } = await import("./pricing.tsx");
const { PricingTable } = await import("../../pricing/pricing-table.tsx");

async function clientProps(searchParams = {}) {
  const tab = await PricingTab({ searchParams });
  const content = tab.props.children.props.children;
  const rendered = await content.type(content.props);
  return rendered.props.children.find((child) => child?.type === PricingTable).props;
}

beforeEach(() => {
  role = "owner";
  product.lastPurchaseNetPrice = null;
  productRows = [product];
  overrides.list.p1 = "140000";
  overrides.trade.p1 = "110000";
});

describe("pricing server-to-client data", () => {
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
      { ...product, id: "rap-e", sku: "RAP2200(E)", name: "Ruijie RAP2200(E)", retailPrice: "1490000" },
      { ...product, id: "rap-f", sku: "RAP2200(F)", name: "Ruijie RAP2200(F)", retailPrice: "1190000" },
    ];
    const props = await clientProps({ q: "2200", category: "network", brandId: "ruijie", status: "active" });
    expect(productFilters).toMatchObject({ view: "flat", q: "2200", categoryId: "network", brandId: "ruijie", status: "active" });
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
