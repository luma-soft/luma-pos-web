import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const tenant = randomUUID(), other = randomUUID();
beforeAll(async () => {
  await pg.exec(`create table catalog_sync_state(store_id uuid, id int, revision bigint, updated_at timestamptz, primary key(store_id,id));`);
  for (const table of ["products", "product_units", "product_prices", "stock_levels", "warehouses", "categories", "brands", "product_combo_items", "price_books", "promotions"]) {
    await pg.exec(`create table ${table}(id uuid primary key default gen_random_uuid(), store_id uuid not null, name text);`);
  }
  const original = await readFile("drizzle/0104_tenant_catalog_and_storage.sql", "utf8");
  await pg.exec(original.split('DROP POLICY')[0]);
  await pg.query("insert into catalog_sync_state values($1,1,20,now()),($2,1,40,now())", [tenant,other]);
  await pg.exec(await readFile("drizzle/0130_pricing_catalog_revision.sql", "utf8"));
});
afterAll(async () => pg.close());
const revision = async (store) => Number((await pg.query("select revision from catalog_sync_state where store_id=$1", [store])).rows[0].revision);

test("migration invalidates existing snapshots once, without changing prices", async () => {
  expect(await revision(tenant)).toBe(21);
  expect(await revision(other)).toBe(41);
});
for (const table of ["price_books", "promotions"]) test(`${table} create/rename/delete only invalidates its tenant`, async () => {
  const start = await revision(tenant), otherStart = await revision(other);
  const id = randomUUID();
  await pg.query(`insert into ${table}(id,store_id,name) values($1,$2,'test')`, [id,tenant]);
  expect(await revision(tenant)).toBe(start + 1);
  await pg.query(`update ${table} set name='changed' where id=$1`, [id]);
  expect(await revision(tenant)).toBe(start + 2);
  await pg.query(`delete from ${table} where id=$1`, [id]);
  expect(await revision(tenant)).toBe(start + 3);
  expect(await revision(other)).toBe(otherStart);
});
