import { afterAll, beforeAll, describe, test } from "bun:test";
import { strict as assert } from "node:assert";
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

async function setup() {
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
}

async function cleanup() {
  await database.close();
}

async function verifyRevisionAdvances() {
  for (const [index, table] of trackedTables.entries()) {
    let before = await revision();
    await database.exec(`insert into ${table} (id, value) values (${index + 1}, 'a')`);
    assert.ok(await revision() > before);

    before = await revision();
    await database.exec(`update ${table} set value = 'b' where id = ${index + 1}`);
    assert.ok(await revision() > before);

    before = await revision();
    await database.exec(`delete from ${table} where id = ${index + 1}`);
    assert.ok(await revision() > before);
  }
}

async function verifyRevisionRollback() {
  await database.exec("insert into stock_levels (id, value) values (100, '10')");
  const before = await revision();

  await database.exec("begin");
  await database.exec("update stock_levels set value = '9' where id = 100");
  assert.ok(await revision() > before);
  await database.exec("rollback");

  assert.equal(await revision(), before);
}

let registeredWithRunner = false;
try {
  beforeAll(setup);
  afterAll(cleanup);

  describe("Product Catalog database revision", () => {
    test("advances for insert, update, and delete on every projected table", async () => {
      await verifyRevisionAdvances();
    });

    test("rolls the revision back with the business transaction", async () => {
      await verifyRevisionRollback();
    });
  });
  registeredWithRunner = true;
} catch (error) {
  const outsideRunner = error instanceof Error
    && error.message.startsWith("Cannot use beforeAll() outside of the test runner");
  if (!outsideRunner) throw error;
}

if (!registeredWithRunner) {
  await setup();
  try {
    await verifyRevisionAdvances();
    await verifyRevisionRollback();
    console.log("✅ product catalog revision advances and rolls back");
  } finally {
    await cleanup();
  }
}
