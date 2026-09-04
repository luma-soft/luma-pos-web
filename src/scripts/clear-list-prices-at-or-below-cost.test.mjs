import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { candidateQuery, clearListPrices } from "./clear-list-prices-at-or-below-cost.mjs";

const pg = new PGlite();
const storeId = "00000000-0000-4000-8000-000000000001";
const otherStore = "00000000-0000-4000-8000-000000000002";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  await pg.exec(`
    create table products (id uuid primary key, store_id uuid, sku text, name text, cost_price numeric(14,2), retail_price numeric(14,2), is_active boolean);
    create table price_books (id uuid primary key, store_id uuid, system_type text);
    create table product_prices (id uuid primary key, store_id uuid, price_book_id uuid, product_id uuid, price numeric(14,2));
    create table audit_logs (store_id uuid, source text, action text, entity_type text, entity_id uuid, status text, "before" jsonb, "after" jsonb, metadata jsonb);
  `);
});
beforeEach(async () => {
  await pg.exec("truncate products, price_books, product_prices, audit_logs");
  for (const [bookId, store, type] of [[id(100), storeId, "list"], [id(101), storeId, null], [id(102), otherStore, "list"]]) {
    await pg.query("insert into price_books values ($1,$2,$3)", [bookId, store, type]);
  }
  // Below, equal, above by one cent, zero, inactive, unknown cost, other tenant.
  for (const [n, cost, price, active, store] of [
    [1, 100, 99, true, storeId], [2, 100, 100, true, storeId], [3, 100, 100.01, true, storeId],
    [4, 0, 0, true, storeId], [5, 100, 90, false, storeId], [6, null, 90, true, storeId], [7, 100, 90, true, otherStore],
  ]) {
    await pg.query("insert into products values ($1,$2,$3,'Product',$4,150,$5)", [id(n), store, `SP${n}`, cost, active]);
    await pg.query("insert into product_prices values ($1,$2,$3,$4,$5)", [id(n + 200), store, store === storeId ? id(100) : id(102), id(n), price]);
  }
  await pg.query("insert into product_prices values ($1,$2,$3,$4,50)", [id(300), storeId, id(101), id(1)]);
});
afterAll(() => pg.close());

const apply = (options = {}) => clearListPrices(pg, { storeId, expectedCount: 4, backup: async () => {}, ...options });

test("removes only target-store list prices <= cost, preserving every other price and product", async () => {
  const products = (await pg.query("select * from products order by id")).rows;
  const prices = (await pg.query("select * from product_prices order by id")).rows;
  let backup;
  expect(await apply({ backup: async (rows) => { backup = rows; } })).toEqual({ cleared: 4, remaining: 0 });
  expect(backup.map((row) => row.sku)).toEqual(["SP1", "SP2", "SP4", "SP5"]);
  expect((await pg.query(candidateQuery, [storeId])).rows).toEqual([]);
  expect((await pg.query("select * from products order by id")).rows).toEqual(products);
  expect((await pg.query("select * from product_prices order by id")).rows).toEqual(prices.filter((row) => !backup.some((item) => item.id === row.id)));
  const audit = (await pg.query("select * from audit_logs")).rows;
  expect(audit).toHaveLength(4);
  expect(audit.every((row) => row.store_id === storeId && row.after.price === null && row.metadata.usesRetailPrice === false)).toBe(true);
  expect(await apply({ expectedCount: 0 })).toEqual({ cleared: 0, remaining: 0 });
  expect((await pg.query("select * from audit_logs")).rows).toHaveLength(4);
});

test("count mismatch aborts without deleting", async () => {
  await expect(apply({ expectedCount: 3 })).rejects.toThrow("Candidate count changed");
  expect((await pg.query(candidateQuery, [storeId])).rows).toHaveLength(4);
});

test("backup failure aborts without deleting or recording successful changes", async () => {
  await expect(apply({ backup: async () => { throw new Error("backup unavailable"); } })).rejects.toThrow("backup unavailable");
  expect((await pg.query(candidateQuery, [storeId])).rows).toHaveLength(4);
  expect((await pg.query("select * from audit_logs")).rows).toHaveLength(0);
});
