import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID(), userId = randomUUID();
const retailId = randomUUID(), costId = randomUUID(), grossId = randomUUID(), customId = randomUUID();
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
  for (const table of [schema.products, schema.productPrices, schema.priceBooks]) {
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

  await pg.exec("create unique index fixture_book_product on product_prices(price_book_id, product_id)");
  await database.insert(schema.priceBooks).values([
    { id: retailId, storeId, name: "Giá Chung", isDefault: true, systemType: "retail" },
    { id: costId, storeId, name: "Giá vốn", costBased: true, managerOnly: true, systemType: "cost" },
    { id: grossId, storeId, name: "Giá Chưa Chiết Khấu", managerOnly: true, systemType: "purchase" },
    { id: customId, storeId, name: "Giá thợ" },
  ]);
  await database.insert(schema.products).values([
    { id: knownId, storeId, sku: "KNOWN", name: "Known", retailPrice: "200", costPrice: "90", lastPurchasePrice: "120" },
    { id: unknownId, storeId, sku: "UNKNOWN", name: "Unknown", retailPrice: "100", costPrice: "50", lastPurchasePrice: null },
  ]);
});
afterAll(async () => { await pg.close(); });
for (const id of [retailId, costId, grossId]) {
  test(`all administration actions refuse system book ${id}`, async () => {
    const expected = { ok: false, error: "pricing.errors.systemReadOnly" };
    expect(await renamePriceBook(id, "New name")).toEqual(expected);
    expect(await deletePriceBook(id)).toEqual(expected);
    expect(await setProductPrice({ priceBookId: id, productId: knownId, price: 123 })).toEqual(expected);
    expect(await applyPriceFormulaAll({ priceBookId: id, base: "current", op: "+", amount: 1, unit: "pct" })).toEqual(expected);
  });
}
test("reserved automatic names cannot create a second custom book", async () => {
  expect(await createPriceBook("  Giá   Chưa Chiết Khấu ")).toEqual({ ok: false, error: "pricing.errors.systemReadOnly" });
});
test("bulk formula with missing gross rejects atomically without falling back to cost", async () => {
  expect(await applyPriceFormulaAll({ priceBookId: customId, base: "lastPurchase", op: "+", amount: 10, unit: "pct" }))
    .toEqual({ ok: false, error: "pricing.errors.priceUnavailable" });
  expect((await pg.query("select count(*)::int as n from product_prices")).rows[0].n).toBe(0);
});
test("custom prices remain editable and formula uses exact gross including zero", async () => {
  expect((await setProductPrice({ priceBookId: customId, productId: knownId, price: 160 })).ok).toBe(true);
  await pg.query("update products set last_purchase_price = 0 where id = $1", [unknownId]);
  const result = await applyPriceFormulaAll({ priceBookId: customId, base: "lastPurchase", op: "+", amount: 10, unit: "pct" });
  expect(result).toEqual({ ok: true, data: { count: 2 } });
  const rows = (await pg.query("select product_id, price from product_prices order by price desc")).rows;
  expect(rows).toEqual([{ product_id: knownId, price: "132.00" }, { product_id: unknownId, price: "0.00" }]);
});

test("product edit reads cannot expose stale automatic overrides", async () => {
  const { getPriceOverrides, getPriceOverridesForProducts } = await import("../data/price-books");
  await database.insert(schema.productPrices).values([
    { storeId, productId: knownId, priceBookId: costId, price: "888" },
    { storeId, productId: knownId, priceBookId: grossId, price: "999" },
  ]);
  expect(await getPriceOverrides(storeId, grossId, [knownId])).toEqual({});
  const overrides = await getPriceOverridesForProducts(storeId, [knownId]);
  expect(overrides).not.toHaveProperty(costId);
  expect(overrides).not.toHaveProperty(grossId);
  expect(overrides[customId][knownId]).toBe("132.00");
});
