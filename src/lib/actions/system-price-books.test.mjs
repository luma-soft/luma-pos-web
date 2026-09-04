import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID(), userId = randomUUID();
const retailId = randomUUID(), costId = randomUUID(), purchaseId = randomUUID(), listId = randomUUID(), customId = randomUUID();
const receiptId = randomUUID();
const knownId = randomUUID(), unknownId = randomUUID();
mock.module("@/db", () => ({ db: database }));
mock.module("@/lib/actions/common", () => ({
  requireManager: async () => ({ ok: true, storeId, userId, role: "owner" }),
  toMoney: (value) => value.toFixed(2),
}));
mock.module("@/lib/sync/revalidate-app-data", () => ({ revalidateAppData: () => {} }));
mock.module("@/lib/audit/activity-log", () => ({ recordActivity: async () => {} }));
mock.module("@/lib/media/config", () => ({ getPublicMediaConfig: () => ({ publicBucket: "test", publicBaseUrl: "https://test.example" }) }));
const { renamePriceBook, deletePriceBook, setProductPrice, applyPriceFormulaAll, createPriceBook } = await import("./price-books");
const dialect = new PgDialect();
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
beforeAll(async () => {
  const enums = new Set();
  for (const table of [schema.products, schema.productPrices, schema.priceBooks, schema.productUnits]) {
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (!column.enumValues?.length || enums.has(column.getSQLType())) continue;
      await pg.exec(`create type ${column.getSQLType()} as enum (${column.enumValues.map(quote).join(",")})`);
      enums.add(column.getSQLType());
    }
    const columns = config.columns.map((column) => {
      const value = column.default;
      const defaultSql = value === undefined ? "" : " default " + (value instanceof SQL
        ? dialect.sqlToQuery(value).sql
        : typeof value === "boolean" || typeof value === "number" ? String(value)
          : quote(typeof value === "string" ? value : JSON.stringify(value)));
      return `"${column.name}" ${column.getSQLType()}${column.notNull ? " not null" : ""}${defaultSql}${column.primary ? " primary key" : ""}`;
    });
    await pg.exec(`create table "${config.name}" (${columns.join(",")})`);
  }

  await pg.exec(`
    create unique index fixture_book_product on product_prices(price_book_id, product_id);
    create table purchase_orders (id uuid primary key, store_id uuid not null, status text not null,
      discount numeric not null default 0, cost_effective_at timestamptz, created_at timestamptz not null default now());
    create table purchase_order_items (id uuid primary key default gen_random_uuid(), store_id uuid not null,
      purchase_order_id uuid not null, product_id uuid not null, quantity numeric not null,
      unit_multiplier numeric not null default 1, total numeric not null);
  `);
  await database.insert(schema.priceBooks).values([
    { id: retailId, storeId, name: "Giá Chung", isDefault: true, systemType: "retail" },
    { id: costId, storeId, name: "Giá vốn", costBased: true, managerOnly: true, systemType: "cost" },
    { id: purchaseId, storeId, name: "Giá nhập cuối", managerOnly: true, systemType: "purchase" },
    { id: customId, storeId, name: "Giá thợ" },
    { id: listId, storeId, name: "Giá chưa chiết khấu", systemType: "list" },
  ]);
  await database.insert(schema.products).values([
    { id: knownId, storeId, sku: "KNOWN", name: "Known", retailPrice: "200", costPrice: "90", lastPurchasePrice: "120" },
    { id: unknownId, storeId, sku: "UNKNOWN", name: "Unknown", retailPrice: "100", costPrice: "50", lastPurchasePrice: null },
  ]);
});
beforeEach(async () => {
  await pg.exec("truncate product_prices, product_units, purchase_order_items, purchase_orders");
  await pg.query("update products set base_unit = 'm', is_active = true, lifecycle_status = 'active', retail_price = case when id = $1 then 200 else 100 end", [knownId]);
  await pg.query("insert into purchase_orders (id, store_id, status) values ($1, $2, 'received')", [receiptId, storeId]);
  await pg.query("insert into purchase_order_items (store_id, purchase_order_id, product_id, quantity, total) values ($1, $2, $3, 2, 160)", [storeId, receiptId, knownId]);
});
afterAll(async () => { await pg.close(); });
const { getPriceOverrides, getPriceOverridesForProducts } = await import("../data/price-books");
const { resolvePriceBookPrice } = await import("../pricing/system-price-books");

for (const [name, id] of [["retail", retailId], ["cost", costId], ["purchase", purchaseId], ["list", listId]]) {
  test(`${name} system book cannot be renamed or deleted`, async () => {
    const expected = { ok: false, error: "pricing.errors.systemReadOnly" };
    expect(await renamePriceBook(id, "New name")).toEqual(expected);
    expect(await deletePriceBook(id)).toEqual(expected);
  });
}
for (const [name, id] of [["cost", costId], ["purchase", purchaseId]]) {
  test(`${name} source cannot be edited manually or by formula`, async () => {
    const expected = { ok: false, error: "pricing.errors.systemReadOnly" };
    expect(await setProductPrice({ priceBookId: id, productId: knownId, price: 123 })).toEqual(expected);
    expect(await applyPriceFormulaAll({ priceBookId: id, base: "current", op: "+", amount: 1, unit: "pct" })).toEqual(expected);
  });
}
test.each(["  Giá   Chưa Chiết Khấu ", "Giá nhập cuối", "Giá vốn", "Giá chung"])("reserved name %s cannot create a second custom book", async (name) => {
  expect(await createPriceBook(name)).toEqual({ ok: false, error: "pricing.errors.systemReadOnly" });
});

test("retail edits update the product source and leave internal prices unchanged", async () => {
  expect((await setProductPrice({ priceBookId: retailId, productId: knownId, price: 175 })).ok).toBe(true);
  expect((await pg.query("select retail_price, cost_price, last_purchase_price from products where id = $1", [knownId])).rows[0])
    .toEqual({ retail_price: "175.00", cost_price: "90.00", last_purchase_price: "120.00" });
  expect((await pg.query("select count(*)::int as n from product_prices")).rows[0].n).toBe(0);
});

test("company catalogue edits and clearing preserve missing prices without retail fallback", async () => {
  expect((await setProductPrice({ priceBookId: listId, productId: knownId, price: 250 })).ok).toBe(true);
  expect(await getPriceOverrides(storeId, listId, [knownId])).toEqual({ [knownId]: "250.00" });
  expect((await setProductPrice({ priceBookId: listId, productId: knownId, price: null })).ok).toBe(true);
  const overrides = await getPriceOverrides(storeId, listId, [knownId]);
  expect(overrides).toEqual({});
  expect(resolvePriceBookPrice({ systemType: "list" }, { retailPrice: 200, lastPurchasePrice: 120 }, overrides[knownId])).toBeNull();
  expect((await pg.query("select retail_price from products where id = $1", [knownId])).rows[0].retail_price).toBe("200.00");
});

test("catalogue-based discount updates only SKUs with a company price", async () => {
  await setProductPrice({ priceBookId: listId, productId: knownId, price: 300 });
  const result = await applyPriceFormulaAll({ priceBookId: retailId, base: "list", op: "-", amount: 20, unit: "pct" });
  expect(result).toEqual({ ok: true, data: { count: 1 } });
  expect((await pg.query("select id, retail_price from products order by sku")).rows)
    .toEqual([{ id: knownId, retail_price: "240.00" }, { id: unknownId, retail_price: "100.00" }]);
  expect(await getPriceOverrides(storeId, listId, [knownId])).toEqual({ [knownId]: "300.00" });
});

test("missing catalogue bases fail without creating prices or changing retail", async () => {
  for (const [priceBookId, base] of [[retailId, "list"], [listId, "current"]]) {
    expect(await applyPriceFormulaAll({ priceBookId, base, op: "+", amount: 10, unit: "pct" }))
      .toEqual({ ok: false, error: "pricing.errors.priceUnavailable" });
  }
  expect((await pg.query("select retail_price from products order by sku")).rows).toEqual([{ retail_price: "200.00" }, { retail_price: "100.00" }]);
  expect((await pg.query("select count(*)::int as n from product_prices")).rows[0].n).toBe(0);
});

test("net receipt formulas skip missing SKUs and retain their existing custom price", async () => {
  await setProductPrice({ priceBookId: customId, productId: unknownId, price: 77 });
  expect(await applyPriceFormulaAll({ priceBookId: customId, base: "lastPurchase", op: "+", amount: 10, unit: "pct" }))
    .toEqual({ ok: true, data: { count: 1 } });
  expect(await getPriceOverrides(storeId, customId)).toEqual({ [knownId]: "88.00", [unknownId]: "77.00" });
});

test("a zero net receipt is an available formula base", async () => {
  await pg.query("insert into purchase_order_items (store_id, purchase_order_id, product_id, quantity, total) values ($1, $2, $3, 1, 0)", [storeId, receiptId, unknownId]);
  expect(await applyPriceFormulaAll({ priceBookId: customId, base: "lastPurchase", op: "+", amount: 10, unit: "pct" }))
    .toEqual({ ok: true, data: { count: 2 } });
  expect(await getPriceOverrides(storeId, customId)).toEqual({ [knownId]: "88.00", [unknownId]: "0.00" });
});

test("price reads expose catalogue values but ignore stale internal overrides", async () => {
  await database.insert(schema.productPrices).values([
    { storeId, productId: knownId, priceBookId: costId, price: "888" },
    { storeId, productId: knownId, priceBookId: purchaseId, price: "999" },
    { storeId, productId: knownId, priceBookId: listId, price: "250" },
    { storeId, productId: knownId, priceBookId: customId, price: "160" },
  ]);
  expect(await getPriceOverrides(storeId, purchaseId, [knownId])).toEqual({});
  expect(await getPriceOverridesForProducts(storeId, [knownId])).toEqual({
    [listId]: { [knownId]: "250.00" }, [customId]: { [knownId]: "160.00" },
  });
});

test("filtered formula updates only matching SKUs, not the rest of the store", async () => {
  expect(await applyPriceFormulaAll({ priceBookId: retailId, base: "current", op: "+", amount: 10, unit: "vnd", filters: { q: "Unknown" } }))
    .toEqual({ ok: true, data: { count: 1 } });
  expect((await pg.query("select retail_price from products where id = $1", [knownId])).rows[0].retail_price).toBe("200.00");
  expect((await pg.query("select retail_price from products where id = $1", [unknownId])).rows[0].retail_price).toBe("110.00");
});

test("invalid filters fail closed instead of broadening a bulk update", async () => {
  for (const filters of [null, [], { categoryIds: "not-an-array" }, { lifecycle: "typo" }, { unknownKey: "x" }]) {
    expect(await applyPriceFormulaAll({ priceBookId: retailId, base: "current", op: "+", amount: 10, unit: "vnd", filters }))
      .toEqual({ ok: false, error: "errors.invalidData" });
  }
});

async function addUnits(productId = knownId) {
  await database.insert(schema.productUnits).values([
    { storeId, productId, unitName: "m", multiplier: "1", priceOverride: "999" },
    { storeId, productId, unitName: "cây", multiplier: "4", priceOverride: "700" },
    { storeId, productId, unitName: "bó", multiplier: "20", priceOverride: null },
  ]);
}

test("retail alternate keep changes only its own override, including zero and clearing", async () => {
  await addUnits();
  for (const price of [33.33, 0, null]) {
    expect((await setProductPrice({ productId: knownId, priceBookId: retailId, unitName: "cây", price, unitPriceMode: "keep" })).ok).toBe(true);
    const [{ price_override }] = (await pg.query("select price_override from product_units where product_id=$1 and unit_name='cây'", [knownId])).rows;
    expect(price_override).toBe(price == null ? null : price.toFixed(2));
    expect((await pg.query("select retail_price from products where id=$1", [knownId])).rows[0].retail_price).toBe("200.00");
  }
});

test("retail synchronize from an alternate converts base and clears overrides atomically", async () => {
  await addUnits();
  expect((await setProductPrice({ productId: knownId, priceBookId: retailId, unitName: "cây", price: 493.32, unitPriceMode: "sync" })).ok).toBe(true);
  expect((await pg.query("select retail_price from products where id=$1", [knownId])).rows[0].retail_price).toBe("123.33");
  expect((await pg.query("select price_override from product_units where product_id=$1", [knownId])).rows.every((row) => row.price_override == null)).toBe(true);
});

test("list/custom unit edits only update their book base, not retail overrides", async () => {
  await addUnits();
  expect((await setProductPrice({ productId: knownId, priceBookId: listId, unitName: "cây", price: 600 })).ok).toBe(true);
  expect(await getPriceOverrides(storeId, listId)).toEqual({ [knownId]: "150.00" });
  // Retail cây=700, retail m=200: custom cây uses a 3.5 ratio, not multiplier 4.
  expect((await setProductPrice({ productId: knownId, priceBookId: customId, unitName: "cây", price: 350 })).ok).toBe(true);
  expect(await getPriceOverrides(storeId, customId)).toEqual({ [knownId]: "100.00" });
  expect((await pg.query("select price_override from product_units where product_id=$1 and unit_name='cây'", [knownId])).rows[0].price_override).toBe("700.00");
});

test("invalid units, retail null base, and nonretail synchronization are rejected", async () => {
  await addUnits();
  for (const input of [
    { priceBookId: retailId, unitName: "missing", price: 10 },
    { priceBookId: retailId, unitName: "m", price: null },
    { priceBookId: listId, unitName: "m", price: 10, unitPriceMode: "sync" },
    { priceBookId: retailId, unitName: "cây", price: null, unitPriceMode: "sync" },
  ]) expect(await setProductPrice({ productId: knownId, ...input })).toEqual({ ok: false, error: "errors.invalidData" });
});

test("bulk unit sync clears overrides only inside the filtered applicable scope", async () => {
  await addUnits(knownId);
  await addUnits(unknownId);
  expect(await applyPriceFormulaAll({ priceBookId: retailId, base: "current", op: "+", amount: 10, unit: "vnd", filters: { q: "Unknown" }, unitPriceMode: "sync" }))
    .toEqual({ ok: true, data: { count: 1 } });
  expect((await pg.query("select price_override from product_units where product_id=$1 and unit_name='cây'", [knownId])).rows[0].price_override).toBe("700.00");
  expect((await pg.query("select price_override from product_units where product_id=$1", [unknownId])).rows.every((row) => row.price_override == null)).toBe(true);
});

test("a concurrent unit-factor change rejects the reviewed sync without any price writes", async () => {
  await addUnits();
  const expected = { baseUnit: "m", retailPrice: 200, basePrice: 200, units: [
    { unitName: "m", multiplier: 1, priceOverride: 999 },
    { unitName: "cây", multiplier: 4, priceOverride: 700 },
    { unitName: "bó", multiplier: 20, priceOverride: null },
  ] };
  await pg.query("update product_units set multiplier=5 where product_id=$1 and unit_name='cây'", [knownId]);
  expect(await setProductPrice({ productId: knownId, priceBookId: retailId, unitName: "cây", price: 64000, unitPriceMode: "sync", expected }))
    .toEqual({ ok: false, error: "pricing.errors.priceChanged" });
  expect((await pg.query("select retail_price from products where id=$1", [knownId])).rows[0].retail_price).toBe("200.00");
  expect((await pg.query("select price_override from product_units where product_id=$1 and unit_name='cây'", [knownId])).rows[0].price_override).toBe("700.00");
});

test("matching snapshot permits save; changed book base is rejected", async () => {
  const expected = { baseUnit: "m", retailPrice: 200, basePrice: null, units: [] };
  const input = { productId: knownId, priceBookId: listId, price: 123.33, expected };
  expect((await setProductPrice(input)).ok).toBe(true);
  expect(await setProductPrice({ ...input, price: 100 })).toEqual({ ok: false, error: "pricing.errors.priceChanged" });
  expect(await getPriceOverrides(storeId, listId)).toEqual({ [knownId]: "123.33" });
});
