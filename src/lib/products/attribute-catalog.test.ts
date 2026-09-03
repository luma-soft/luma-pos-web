import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { attributeNameSchema } from "./attribute-catalog";

const pg = new PGlite();
const store = "00000000-0000-4000-8000-000000000001";
const otherStore = "00000000-0000-4000-8000-000000000002";
const imported = "00000000-0000-4000-8000-000000000003";
const archived = "00000000-0000-4000-8000-000000000004";
const originalSpecs = { SIZE: ["140"], "PN(ÁP LỰC)": ["C3"], __orderNote: "Keep note" };

before(async () => {
  await pg.exec(`
    create role anon; create role authenticated;
    create table stores(id uuid primary key);
    create table products(id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id),
      specs jsonb, is_active boolean default true, cost_price numeric default 990000, stock numeric default 2,
      updated_at timestamptz default '2020-01-01'::timestamptz,
      unique(store_id,id));
    insert into stores values ('${store}'), ('${otherStore}');
  `);
  await pg.query("insert into products(id,store_id,specs) values ($1,$2,$3)", [imported, store, JSON.stringify(originalSpecs)]);
  await pg.query("insert into products(id,store_id,specs,is_active) values ($1,$2,$3,false)", [archived, store, JSON.stringify({ "Phiên bản": ["F"] })]);
  await pg.exec(await readFile(new URL("../../../drizzle/0122_product_attributes.sql", import.meta.url), "utf8"));
  await pg.exec(await readFile(new URL("../../../drizzle/0123_product_attribute_rename_sync.sql", import.meta.url), "utf8"));
});
after(async () => { await pg.close(); });

test("backfill preserves imported values, internal notes, prices and stock", async () => {
  const { rows } = await pg.query<{ specs: unknown; cost_price: string; stock: string }>("select specs,cost_price,stock from products where id=$1", [imported]);
  assert.deepEqual(rows[0], { specs: originalSpecs, cost_price: "990000", stock: "2" });
  assert.equal((await pg.query("select * from product_attributes")).rows.length, 3);
  assert.equal((await pg.query("select * from product_attribute_products")).rows.length, 3);
});

test("create, reject duplicate names and delete an unused attribute", async () => {
  await pg.query("insert into product_attributes(store_id,name) values ($1,'Màu sắc')", [store]);
  await assert.rejects(pg.query("insert into product_attributes(store_id,name) values ($1,'  MÀU   SẮC  ')", [store]), { code: "23505" });
  await pg.query("delete from product_attributes where store_id=$1 and name='Màu sắc'", [store]);
  assert.equal((await pg.query("select * from product_attribute_aliases where name_key='màu sắc'")).rows.length, 0);
});

test("database refuses deletion of used attributes, including inactive products", async () => {
  for (const name of ["SIZE", "Phiên bản"]) {
    await assert.rejects(pg.query("delete from product_attributes where store_id=$1 and name=$2", [store, name]), { code: "23503" });
  }
});

test("rename keeps identity and values; a later KiotViet import or stale form uses the new name", async () => {
  const { rows: [attribute] } = await pg.query<{ id: string }>("select id from product_attributes where store_id=$1 and name='SIZE'", [store]);
  await pg.query("select rename_product_attribute($1,$2,'Kích cỡ')", [store, attribute.id]);
  assert.equal((await pg.query("select id from products where id=$1 and updated_at > '2020-01-02'::timestamptz", [imported])).rows.length, 1);
  assert.deepEqual((await pg.query<{ specs: unknown }>("select specs from products where id=$1", [imported])).rows[0].specs, { "Kích cỡ": ["140"], "PN(ÁP LỰC)": ["C3"], __orderNote: "Keep note" });
  await pg.query("update products set specs=$1 where id=$2", [JSON.stringify(originalSpecs), imported]);
  assert.deepEqual((await pg.query<{ specs: Record<string, unknown> }>("select specs from products where id=$1", [imported])).rows[0].specs["Kích cỡ"], ["140"]);
  assert.equal((await pg.query("select * from product_attribute_products where attribute_id=$1", [attribute.id])).rows.length, 1);
  await assert.rejects(pg.query("insert into product_attributes(store_id,name) values ($1,'SIZE')", [store]), { code: "23505" });
});

test("rename collision rolls back without overwriting either attribute's values", async () => {
  const { rows: [attribute] } = await pg.query<{ id: string }>("select id from product_attributes where store_id=$1 and name='Kích cỡ'", [store]);
  await assert.rejects(pg.query("select rename_product_attribute($1,$2,'PN(ÁP LỰC)')", [store, attribute.id]), { code: "23505" });
  assert.equal((await pg.query<{ name: string }>("select name from product_attributes where id=$1", [attribute.id])).rows[0].name, "Kích cỡ");
});

test("new legacy products register usage; removing a field releases only its reference", async () => {
  const { rows: [created] } = await pg.query<{ id: string }>("insert into products(store_id,specs) values ($1,$2) returning id", [store, JSON.stringify({ "Dung tích": ["20L"] })]);
  await assert.rejects(pg.query("delete from product_attributes where store_id=$1 and name='Dung tích'", [store]), { code: "23503" });
  await pg.query("update products set specs=null where id=$1", [created.id]);
  await pg.query("delete from product_attributes where store_id=$1 and name='Dung tích'", [store]);
});

test("same names are isolated by store and cross-store references are forbidden", async () => {
  const { rows: [attribute] } = await pg.query<{ id: string }>("insert into product_attributes(store_id,name) values ($1,'Kích cỡ') returning id", [otherStore]);
  assert.equal((await pg.query<{ renamed: boolean }>("select rename_product_attribute($1,$2,'Wrong') as renamed", [store, attribute.id])).rows[0].renamed, false);
  await assert.rejects(pg.query("insert into product_attribute_products(store_id,product_id,attribute_id) values ($1,$2,$3)", [store, imported, attribute.id]), { code: "23503" });
  await pg.query("delete from product_attributes where store_id=$1 and id=$2", [otherStore, attribute.id]);
});

test("reserved/internal and blank names cannot be created", async () => {
  for (const name of [" ", "__orderNote", "x".repeat(101)]) assert.equal(attributeNameSchema.safeParse(name).success, false);
  assert.equal(attributeNameSchema.parse("  Phiên   bản  "), "Phiên bản");
});
