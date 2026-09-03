import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const database = new PGlite();
const storeA = "00000000-0000-4000-8000-000000000001";
const storeB = "00000000-0000-4000-8000-000000000002";
const tables = [
  "products",
  "product_units",
  "product_prices",
  "stock_levels",
  "warehouses",
  "categories",
  "brands",
  "product_combo_items",
];

async function revision(storeId) {
  const result = await database.query(
    "select revision from catalog_sync_state where store_id = $1 and id = 1",
    [storeId],
  );
  return Number(result.rows[0].revision);
}

beforeAll(async () => {
  await database.exec(`
    create table catalog_sync_state (
      store_id uuid not null, id smallint not null, revision bigint not null,
      updated_at timestamptz not null, primary key (store_id, id)
    );
    insert into catalog_sync_state values
      ('${storeA}', 1, 42, now()), ('${storeB}', 1, 100, now());
  `);
  for (const table of tables) {
    await database.exec(`create table ${table} (store_id uuid not null, id integer primary key, value text);`);
  }
  const migration = readFileSync(
    new URL("../drizzle/0104_tenant_catalog_and_storage.sql", import.meta.url),
    "utf8",
  );
  // The first two migration statements install the tenant-owned revision
  // function and triggers. Later statements configure auth/storage policies.
  for (const statement of migration.split("--> statement-breakpoint").slice(0, 2)) {
    await database.exec(statement);
  }
});

afterAll(async () => database.close());

describe("tenant Product Catalog database revision", () => {
  test.each(tables)("invalidates only the changed store on %s insert, update, and delete", async (table) => {
    for (const statement of [
      `insert into ${table} values ('${storeA}', 1, 'a')`,
      `update ${table} set value = 'b' where id = 1`,
      `delete from ${table} where id = 1`,
    ]) {
      const before = await revision(storeA);
      await database.exec(statement);

      expect(await revision(storeA)).toBe(before + 1);
      expect(await revision(storeB)).toBe(100);
    }
  });

  test("rolls stock invalidation back with the inventory transaction", async () => {
    const before = await revision(storeA);

    await database.exec("begin");
    await database.exec(`insert into stock_levels values ('${storeA}', 2, '0')`);
    expect(await revision(storeA)).toBe(before + 1);
    await database.exec("rollback");

    expect(await revision(storeA)).toBe(before);
    expect(await revision(storeB)).toBe(100);
  });
});
