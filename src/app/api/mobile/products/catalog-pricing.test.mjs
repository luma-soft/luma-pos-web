import { expect, mock, test } from "bun:test";

let role = "cashier", authorized = true;
let promos = {};
const bookRequests = [];
mock.module("@/lib/mobile/auth", () => ({
  requireMobileStockReadAccess: async () => authorized ? { ok: true, role, storeId: "tenant-a" } : { ok: false, error: "errors.unauthorized" },
  requireMobileStockAccess: async () => ({ ok: false, error: "errors.forbidden" }),
}));
mock.module("@/lib/actions/products", () => ({ createProduct: async () => ({ ok: false }) }));
mock.module("@/lib/data/products", () => ({
  getMobileProducts: async () => ({ rows: [{ id: "p1", lastPurchaseNetPrice: 80 }], total: 1 }),
  getMobileProductOptions: async () => ({ categories: [] }),
}));
mock.module("@/lib/data/price-books", () => ({ getPriceBooks: async (storeId, options) => {
  bookRequests.push([storeId, options]);
  return options.includeManagerOnly ? [{ id: "cost" }, { id: "retail" }] : [{ id: "retail" }];
} }));
mock.module("@/lib/data/active-promotions", () => ({ getActivePromotions: async () => promos }));
const { GET } = await import("./route");
const request = () => new Request("http://localhost/api/mobile/products?page=1&pageSize=50");

test("catalog response explicitly clears removed promotions and filters manager books", async () => {
  role = "cashier"; promos = {};
  const response = await GET(request());
  const body = await response.json();
  expect(body.data.promoByProduct).toEqual({});
  expect(body.data.priceBooks).toEqual([{ id: "retail" }]);
  expect(body.data.products.rows[0].lastPurchaseNetPrice).toBeNull();
  expect(bookRequests.at(-1)).toEqual(["tenant-a", { includeManagerOnly: false }]);
});

test("manager catalog includes active tiers alongside role-authorized books", async () => {
  role = "owner"; promos = { p1: [{ minQty: 1, discountPct: 10 }] };
  const body = await (await GET(request())).json();
  expect(body.data.promoByProduct).toEqual(promos);
  expect(body.data.priceBooks).toEqual([{ id: "cost" }, { id: "retail" }]);
  expect(body.data.products.rows[0].lastPurchaseNetPrice).toBe(80);
});

test("unauthorized catalog does not fetch pricing metadata", async () => {
  authorized = false;
  const before = bookRequests.length;
  expect((await GET(request())).status).toBe(401);
  expect(bookRequests.length).toBe(before);
  authorized = true;
});
