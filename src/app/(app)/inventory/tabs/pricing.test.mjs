import { beforeEach, describe, expect, mock, test } from "bun:test";

let role = "owner";
let bookOptions;
const books = [
  { id: "retail", name: "Giá Chung", systemType: "retail", isDefault: true, managerOnly: false, sortOrder: 0 },
  { id: "cost", name: "Giá vốn", systemType: "cost", isDefault: false, managerOnly: true, sortOrder: 1 },
  { id: "purchase", name: "Giá Chưa Chiết Khấu", systemType: "purchase", isDefault: false, managerOnly: true, sortOrder: 2 },
  { id: "trade", name: "Giá thợ", systemType: null, isDefault: false, managerOnly: false, sortOrder: 3 },
];
const product = { id: "p1", sku: "SP001", name: "Ống nhựa", baseUnit: "m", costPrice: "90000", lastPurchasePrice: null, retailPrice: "120000" };
const overrides = { retail: { p1: "9" }, cost: { p1: "8" }, purchase: { p1: "7" }, trade: { p1: "110000" } };

mock.module("@/lib/auth/store-context", () => ({ requireStoreContext: async () => ({ storeId: "store-1", role }) }));
mock.module("@/lib/data/price-books", () => ({
  getPriceBooks: async (_storeId, options) => {
    bookOptions = options;
    return options?.includeManagerOnly === false ? books.filter((book) => !book.managerOnly) : books;
  },
  getPriceOverridesForProducts: async () => overrides,
}));
mock.module("@/lib/data/products", () => ({
  getProducts: async () => ({ rows: [product], total: 1, pageCount: 1 }),
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

async function clientProps() {
  const tab = await PricingTab({ searchParams: {} });
  const content = tab.props.children.props.children;
  const rendered = await content.type(content.props);
  return rendered.props.children.find((child) => child?.type === PricingTable).props;
}

beforeEach(() => {
  role = "owner";
  product.lastPurchasePrice = null;
  overrides.trade.p1 = "110000";
});

describe("pricing server-to-client data", () => {
  test("system prices come from product sources and ignore manual overrides", async () => {
    const props = await clientProps();
    expect(props.rows[0].prices).toEqual({ retail: 120000, cost: 90000, purchase: null, trade: 110000 });
    expect(props.rows[0].lastPurchase).toBeNull();
    expect(props.canViewPurchasePrices).toBe(true);
  });

  test("zero purchase price survives the server boundary", async () => {
    product.lastPurchasePrice = "0";
    const props = await clientProps();
    expect(props.rows[0].prices.purchase).toBe(0);
    expect(props.rows[0].lastPurchase).toBe(0);
  });

  test("custom books retain an empty override for the retail placeholder", async () => {
    delete overrides.trade.p1;
    expect((await clientProps()).rows[0].prices.trade).toBeNull();
  });

  test.each(["owner", "manager"])("%s can see purchase sources", async (allowedRole) => {
    role = allowedRole;
    product.lastPurchasePrice = "100000";
    const props = await clientProps();
    expect(bookOptions).toEqual({ includeManagerOnly: true });
    expect(props.rows[0].prices.purchase).toBe(100000);
    expect(props.rows[0].costPrice).toBe(90000);
  });

  test.each(["cashier", "warehouse"])("%s receives neither internal books nor purchase sources", async (restrictedRole) => {
    role = restrictedRole;
    product.lastPurchasePrice = "100000";
    const props = await clientProps();
    expect(bookOptions).toEqual({ includeManagerOnly: false });
    expect(props.books.map((book) => book.id)).toEqual(["retail", "trade"]);
    expect(props.rows[0].prices).toEqual({ retail: 120000, trade: 110000 });
    expect(props.rows[0].costPrice).toBeNull();
    expect(props.rows[0].lastPurchase).toBeNull();
    expect(props.canViewPurchasePrices).toBe(false);
  });
});
