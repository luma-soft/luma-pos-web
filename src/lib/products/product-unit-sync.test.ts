import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { syncProductUnits, type ProductUnitSyncValue } from "./product-unit-sync";

// An isolated in-memory Postgres instance: these tests never open DATABASE_URL.
const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID();
const otherStoreId = randomUUID();

before(async () => {
  await pg.exec(`
    create table stores(id uuid primary key);
    create table products(id uuid primary key, store_id uuid not null references stores(id));
  `);
  const dialect = new PgDialect();
  const config = getTableConfig(schema.productUnits);
  // Exercise the production column types/defaults, including decimal precision.
  const definitions = config.columns.map((column) => {
    const value = column.default;
    const defaultSql = value === undefined ? "" : ` default ${value instanceof SQL
      ? dialect.sqlToQuery(value).sql
      : String(value)}`;
    return `"${column.name}" ${column.getSQLType()}${column.notNull ? " not null" : ""}${defaultSql}${column.primary ? " primary key" : ""}`;
  });
  await pg.exec(`create table "${config.name}" (${definitions.join(",")},
    foreign key (store_id) references stores(id),
    foreign key (product_id) references products(id))`);
  await pg.query("insert into stores(id) values ($1), ($2)", [storeId, otherStoreId]);
});

after(async () => { await pg.close(); });

async function seedUnit(overrides: Partial<typeof schema.productUnits.$inferInsert> = {}) {
  const productId = overrides.productId ?? randomUUID();
  const targetStoreId = overrides.storeId ?? storeId;
  await pg.query("insert into products(id,store_id) values ($1,$2)", [productId, targetStoreId]);
  const [unit] = await database.insert(schema.productUnits).values({
    storeId: targetStoreId,
    productId,
    unitName: "cây",
    multiplier: "4",
    priceOverride: "60000",
    sku: `UNIT-${randomUUID().slice(0, 8)}`,
    ...overrides,
  }).returning();
  return unit;
}

async function save(productId: string, units: ProductUnitSyncValue[], targetStoreId = storeId) {
  await database.transaction((tx) => syncProductUnits(
    tx as unknown as Parameters<typeof syncProductUnits>[0],
    { storeId: targetStoreId, productId, units },
  ));
}

async function readUnit(id: string) {
  const [unit] = await database.select().from(schema.productUnits).where(eq(schema.productUnits.id, id));
  return unit;
}

test("saving unchanged unit metadata with omitted priceOverride preserves the fixed price and identity", async () => {
  const before = await seedUnit();
  await save(before.productId, [{ id: before.id, unitName: "cây", multiplier: 4 }]);
  assert.deepEqual(await readUnit(before.id), before);
});

test("renaming an existing unit by ID keeps its omitted fixed price and SKU", async () => {
  const before = await seedUnit();
  await save(before.productId, [{ id: before.id, unitName: " cây 4 mét ", multiplier: 4, barcode: "NEW-CODE" }]);
  assert.deepEqual(await readUnit(before.id), {
    ...before,
    unitName: "cây 4 mét",
    barcode: "NEW-CODE",
  });
});

test("legacy name matching preserves a fixed price when the unit ID and price are omitted", async () => {
  const before = await seedUnit();
  await save(before.productId, [{ unitName: " cây ", multiplier: 4 }]);
  assert.deepEqual(await readUnit(before.id), before);
});

test("explicit null clears the fixed price to select linked pricing", async () => {
  const before = await seedUnit();
  await save(before.productId, [{ id: before.id, unitName: "cây", multiplier: 4, priceOverride: null }]);
  assert.deepEqual(await readUnit(before.id), { ...before, priceOverride: null });
});

test("zero is a real fixed price and remains fixed on a later metadata-only save", async () => {
  const before = await seedUnit();
  await save(before.productId, [{ id: before.id, unitName: "cây", multiplier: 4, priceOverride: 0 }]);
  assert.equal((await readUnit(before.id)).priceOverride, "0.00");
  await save(before.productId, [{ id: before.id, unitName: "cây", multiplier: 4 }]);
  assert.deepEqual(await readUnit(before.id), { ...before, priceOverride: "0.00" });
});

test("fractional multipliers are stored exactly without rounding to whole base units", async () => {
  const before = await seedUnit({ multiplier: "2.5" });
  await save(before.productId, [{ id: before.id, unitName: "cây", multiplier: 2.5 }]);
  assert.deepEqual(await readUnit(before.id), before);
  await save(before.productId, [{ id: before.id, unitName: "cây", multiplier: 2.7812 }]);
  assert.deepEqual(await readUnit(before.id), { ...before, multiplier: "2.7812" });
});

test("new units default to linked pricing while an explicit zero is retained", async () => {
  const productId = randomUUID();
  await pg.query("insert into products(id,store_id) values ($1,$2)", [productId, storeId]);
  await save(productId, [
    { unitName: "cây", multiplier: 2.5 },
    { unitName: "bó", multiplier: 25, priceOverride: 0 },
  ]);
  const units = await database.select().from(schema.productUnits)
    .where(eq(schema.productUnits.productId, productId)).orderBy(schema.productUnits.sortOrder);
  assert.deepEqual(units.map((unit) => [unit.unitName, unit.multiplier, unit.priceOverride]), [
    ["cây", "2.5000", null],
    ["bó", "25.0000", "0.00"],
  ]);
});

test("unknown or foreign unit IDs are rejected and roll back all changes in the transaction", async () => {
  const before = await seedUnit();
  const sameStoreOtherProduct = await seedUnit();
  const otherStoreUnit = await seedUnit({ storeId: otherStoreId });
  for (const id of [randomUUID(), sameStoreOtherProduct.id, otherStoreUnit.id]) {
    await assert.rejects(save(before.productId, [
      { id: before.id, unitName: "cây", multiplier: 4, priceOverride: null },
      { id, unitName: "bó", multiplier: 40, priceOverride: 1 },
    ]), /PRODUCT_UNIT_NOT_FOUND/);
    assert.deepEqual(await readUnit(before.id), before);
    assert.deepEqual(await readUnit(sameStoreOtherProduct.id), sameStoreOtherProduct);
    assert.deepEqual(await readUnit(otherStoreUnit.id), otherStoreUnit);
  }
});
