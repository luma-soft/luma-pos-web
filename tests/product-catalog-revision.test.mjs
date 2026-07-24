import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const database = new PGlite();
const trackedTables = [
  "products",
  "product_units",
  "product_prices",
  "stock_levels",
  "warehouses",
  "categories",
  "brands",
];

async function revision() {
  const result = await database.query("select revision from catalog_sync_state where id = 1");
  return Number(result.rows[0].revision);
}

beforeAll(async () => {
  for (const table of trackedTables) {
    await database.exec(`create table ${table} (id integer primary key, value text)`);
  }

  const migration = readFileSync(
    new URL("../drizzle/0061_product_catalog_revision.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await database.exec(statement);
  }
});

afterAll(async () => {
  await database.close();
});

describe("Product Catalog database revision", () => {
  test("advances for insert, update, and delete on every projected table", async () => {
    for (const [index, table] of trackedTables.entries()) {
      let before = await revision();
      await database.exec(`insert into ${table} (id, value) values (${index + 1}, 'a')`);
      expect(await revision()).toBeGreaterThan(before);

      before = await revision();
      await database.exec(`update ${table} set value = 'b' where id = ${index + 1}`);
      expect(await revision()).toBeGreaterThan(before);

      before = await revision();
      await database.exec(`delete from ${table} where id = ${index + 1}`);
      expect(await revision()).toBeGreaterThan(before);
    }
  });

  test("rolls the revision back with the business transaction", async () => {
    await database.exec("insert into stock_levels (id, value) values (100, '10')");
    const before = await revision();

    await database.exec("begin");
    await database.exec("update stock_levels set value = '9' where id = 100");
    expect(await revision()).toBeGreaterThan(before);
    await database.exec("rollback");

    expect(await revision()).toBe(before);
  });
});
