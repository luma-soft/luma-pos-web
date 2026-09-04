import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const storeId = randomUUID(), sparseStoreId = randomUUID(), otherStoreId = randomUUID();
const retailId = randomUUID(), costId = randomUUID(), grossId = randomUUID(), customId = randomUUID();
const productId = randomUUID(), oldPurchaseId = randomUUID();
const actors = { owner: randomUUID(), manager: randomUUID(), cashier: randomUUID(), inactive: randomUUID() };

beforeAll(async () => {
  // Minimal pre-0126 schema. Execute the real migration SQL, including triggers,
  // constraints, row policies, adoption of existing IDs and the new-store hook.
  await pg.exec(`
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.user_id', true), '')::uuid
    $$;
    create table stores (id uuid primary key default gen_random_uuid(), slug text not null, status text not null default 'active');
    create table profiles (id uuid primary key, store_id uuid not null references stores(id), role text not null, is_active boolean not null default true);
    create function public.current_active_store_id() returns uuid language sql stable security definer set search_path = public as $$
      select p.store_id from profiles p join stores s on s.id = p.store_id
      where p.id = auth.uid() and p.is_active and s.status = 'active' limit 1
    $$;
    create table price_books (
      id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id), name text not null,
      is_default boolean not null default false, manager_only boolean not null default false,
      cost_based boolean not null default false, sort_order integer not null default 0,
      created_at timestamptz not null default now(), unique(store_id,id)
    );
    create unique index price_books_store_default_unique on price_books(store_id) where is_default;
    create table product_prices (
      id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id),
      price_book_id uuid not null, product_id uuid not null, price numeric(14,2) not null,
      foreign key(store_id,price_book_id) references price_books(store_id,id) on delete cascade,
      unique(price_book_id,product_id)
    );
    create table purchase_orders (id uuid primary key default gen_random_uuid(), store_id uuid not null references stores(id), total numeric(14,2) not null default 0);
    create table order_items (id uuid primary key default gen_random_uuid(), store_id uuid not null, price_book_id uuid);
    create table purchase_order_items (id uuid primary key default gen_random_uuid(), store_id uuid not null, product_id uuid not null, purchase_order_id uuid not null);
    alter table price_books enable row level security;
    alter table product_prices enable row level security;
    create policy store_member_select on price_books for select to authenticated using(store_id = public.current_active_store_id());
    create policy store_member_select on product_prices for select to authenticated using(store_id = public.current_active_store_id());
    grant usage on schema public,auth to authenticated;
    grant select on price_books,product_prices,profiles to authenticated;
    grant execute on function auth.uid(),public.current_active_store_id() to authenticated;
  `);
  await pg.query("insert into stores(id,slug) values($1,'existing'),($2,'sparse'),($3,'other')", [storeId, sparseStoreId, otherStoreId]);
  await pg.query(`insert into price_books(id,store_id,name,is_default,cost_based,manager_only,sort_order) values
    ($1,$5,'Giá bán lẻ',true,false,false,3),
    ($2,$5,'Giá vốn cũ',false,true,true,6),
    ($3,$5,' giá chưa  chiết khấu ',false,false,false,8),
    ($4,$5,'Giá thợ',false,false,false,9)`, [retailId, costId, grossId, customId, storeId]);
  await pg.query("insert into price_books(store_id,name,is_default) values($1,'Giá lẻ',true)", [sparseStoreId]);
  for (const [role, id] of Object.entries(actors)) {
    await pg.query("insert into profiles(id,store_id,role,is_active) values($1,$2,$3,$4)", [id, storeId, role === "inactive" ? "owner" : role, role !== "inactive"]);
  }
  for (const id of [retailId, costId, grossId, customId]) {
    await pg.query("insert into product_prices(store_id,price_book_id,product_id,price) values($1,$2,$3,777)", [storeId, id, productId]);
  }
  await pg.query("insert into purchase_orders(id,store_id,total) values($1,$2,123)", [oldPurchaseId, storeId]);
  await pg.query("insert into order_items(store_id,price_book_id) values($1,$2)", [storeId, grossId]);
  for (const filename of ["0126_system_price_books.sql", "0127_purchase_shipping_fee.sql"]) {
    const sql = await readFile(new URL(`../../drizzle/${filename}`, import.meta.url), "utf8");
    await pg.exec(sql);
  }
  const migration = process.env.PRICE_WORKFLOW_MIGRATION || "drizzle/0129_four_price_books.sql";
  await pg.exec(await readFile(migration, "utf8"));
});
afterAll(async () => { await pg.close(); });

async function asActor(actorId, query, params = []) {
  await pg.query("select set_config('test.user_id',$1,false)", [actorId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(query, params); }
  finally { await pg.exec("reset role"); }
}

test("four books preserve IDs, requested order and historical invoice label", async () => {
  const result = await pg.query("select id,name,system_type,manager_only from price_books where store_id=$1 order by sort_order", [storeId]);
  expect(result.rows.map(row => [row.name,row.system_type,row.manager_only])).toEqual([
    ["Giá vốn","cost",true], ["Giá nhập cuối","purchase",true], ["Giá chưa chiết khấu","list",false], ["Giá chung","retail",false], ["Giá thợ",null,false],
  ]);
  expect(result.rows[0].id).toBe(costId);
  expect(result.rows[1].id).toBe(grossId);
  expect(result.rows[3].id).toBe(retailId);
  expect((await pg.query("select price_book_name,pre_discount_unit_price from order_items")).rows).toEqual([
    { price_book_name: "Giá Chưa Chiết Khấu", pre_discount_unit_price: null },
  ]);
  const listId = result.rows[2].id;
  expect((await pg.query("select * from product_prices where price_book_id=$1", [listId])).rows).toHaveLength(0);
});

test("catalogue price editable, no acquisition overrides exposed to cashier", async () => {
  const listId = (await pg.query("select id from price_books where store_id=$1 and system_type='list'", [storeId])).rows[0].id;
  await pg.query("insert into product_prices(store_id,product_id,price_book_id,price) values($1,$2,$3,100000)", [storeId,productId,listId]);
  await pg.query("update product_prices set price=110000 where price_book_id=$1", [listId]);
  const visible = await asActor(actors.cashier, "select system_type from price_books where system_type is not null order by sort_order");
  expect(visible.rows.map(row=>row.system_type)).toEqual(["list","retail"]);
  const prices = await asActor(actors.cashier, "select price_book_id,price from product_prices order by price");
  expect(prices.rows.map(row=>row.price_book_id)).toEqual([customId,listId]);
  expect(prices.rows[1].price).toBe("110000.00");
  await expect(pg.query("update price_books set name='Other' where id=$1", [listId])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
  await expect(pg.query("delete from price_books where id=$1", [listId])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
  await pg.query("delete from product_prices where price_book_id=$1", [listId]);
});

test("cost and purchase prices remain protected and retail cannot gain stale overrides", async () => {
  for(const id of [costId,grossId,retailId]) {
    await expect(pg.query("update product_prices set price=999 where price_book_id=$1", [id])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
  }
  await expect(pg.query("insert into price_books(store_id,name) values($1,'  GIÁ NHẬP CUỐI ')", [storeId])).rejects.toThrow("SYSTEM_PRICE_BOOK_NAME_RESERVED");
});

test("new stores receive the same four ordered system books", async () => {
  const id = randomUUID();
  await pg.query("insert into stores(id,slug) values($1,'new-four')", [id]);
  expect((await pg.query("select system_type from price_books where store_id=$1 order by sort_order", [id])).rows.map(row=>row.system_type)).toEqual(["cost","purchase","list","retail"]);
});

test("invalid discount snapshots are rejected without changing legacy rows", async () => {
  await expect(pg.query("update order_items set line_discount_mode='invalid'")).rejects.toThrow("order_items_discount_snapshot_check");
  await expect(pg.query("update order_items set pre_discount_unit_price=-1")).rejects.toThrow("order_items_discount_snapshot_check");
});
