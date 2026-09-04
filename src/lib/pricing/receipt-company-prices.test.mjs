import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const pg = new PGlite();
const database = drizzle(pg);
const storeId = randomUUID(), userId = randomUUID(), receiptId = randomUUID();
const listId = randomUUID(), productId = randomUUID(), secondId = randomUUID();
const activity = [];
mock.module("@/lib/audit/activity-log", () => ({ recordActivity: async (_tx, event) => { activity.push(event); } }));
const { updateReceiptCompanyPrices } = await import("./receipt-company-prices");

beforeAll(async () => {
  await pg.exec(`
    create table price_books (id uuid primary key, store_id uuid not null, name text not null, system_type text);
    create table product_prices (id uuid primary key default gen_random_uuid(), store_id uuid not null,
      price_book_id uuid not null, product_id uuid not null, price numeric(14,2) not null,
      unique (price_book_id, product_id));
  `);
  await pg.query("insert into price_books values ($1,$2,'Giá chưa chiết khấu','list')", [listId, storeId]);
});
beforeEach(async () => {
  await pg.exec("truncate product_prices");
  activity.length = 0;
});
afterAll(async () => { await pg.close(); });

const apply = (items, role = "manager") => database.transaction((tx) =>
  updateReceiptCompanyPrices(tx, { storeId, userId, role }, receiptId, items));
const prices = async () => (await pg.query("select product_id, price from product_prices order by product_id")).rows;

test("normal receipts leave company prices untouched unless each line opts in", async () => {
  await pg.query("insert into product_prices (store_id,price_book_id,product_id,price) values ($1,$2,$3,90000)", [storeId, listId, productId]);
  await apply([{ productId, unitCost: 100000 }, { productId: secondId, unitCost: 200000, updateCompanyPrice: false }], "warehouse");
  expect(await prices()).toEqual([{ product_id: productId, price: "90000.00" }]);
  expect(activity).toHaveLength(0);
});

test.each(["owner", "manager"])("%s opt-in stores gross company price before receipt discounts", async (role) => {
  await apply([{ productId, unitCost: 100000, discount: 35000, total: 65000, updateCompanyPrice: true },
    { productId: secondId, unitCost: 200000 }], role);
  expect(await prices()).toEqual([{ product_id: productId, price: "100000.00" }]);
  expect(activity).toHaveLength(1);
  expect(activity[0]).toMatchObject({
    storeId, actorId: userId, entityId: productId, action: "product.price_book.updated",
    before: { price: null }, after: { price: 100000 },
    metadata: { receiptId, priceBookId: listId, source: "receipt_opt_in", beforeSupplierDiscount: true },
  });
});

test("manager opt-in updates an existing company price using the already converted base-unit cost", async () => {
  await pg.query("insert into product_prices (store_id,price_book_id,product_id,price) values ($1,$2,$3,90000)", [storeId, listId, productId]);
  // Caller converted a 1,000,000 VND box of 10 into 100,000 VND per base unit.
  await apply([{ productId, unitCost: 100000, updateCompanyPrice: true }]);
  expect(await prices()).toEqual([{ product_id: productId, price: "100000.00" }]);
  expect(activity[0]).toMatchObject({ before: { price: 90000 }, after: { price: 100000 } });
});

test("warehouse staff cannot opt in to company price changes", async () => {
  await expect(apply([{ productId, unitCost: 100000, updateCompanyPrice: true }], "warehouse"))
    .rejects.toThrow("COMPANY_PRICE_FORBIDDEN");
  expect(await prices()).toEqual([]);
  expect(activity).toHaveLength(0);
});

test("conflicting gross prices for a repeated SKU reject without partial writes", async () => {
  await expect(apply([
    { productId: secondId, unitCost: 200000, updateCompanyPrice: true },
    { productId, unitCost: 100000, updateCompanyPrice: true },
    { productId, unitCost: 110000, updateCompanyPrice: true },
  ])).rejects.toThrow("COMPANY_PRICE_CONFLICT");
  expect(await prices()).toEqual([]);
  expect(activity).toHaveLength(0);
});

test("repeated matching SKU prices write and audit once", async () => {
  await apply([
    { productId, unitCost: 100000, updateCompanyPrice: true },
    { productId, unitCost: 100000, updateCompanyPrice: true },
  ]);
  expect(await prices()).toEqual([{ product_id: productId, price: "100000.00" }]);
  expect(activity).toHaveLength(1);
});
