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
  for (const filename of ["0126_system_price_books.sql", "0127_purchase_shipping_fee.sql"]) {
    const sql = await readFile(new URL(`../../drizzle/${filename}`, import.meta.url), "utf8");
    await pg.exec(sql);
  }
});
afterAll(async () => { await pg.close(); });

async function asActor(actorId, query, params = []) {
  await pg.query("select set_config('test.user_id',$1,false)", [actorId]);
  await pg.exec("set role authenticated");
  try { return await pg.query(query, params); }
  finally { await pg.exec("reset role"); }
}

test("migration preserves existing book IDs and adopts the three source types", async () => {
  const result = await pg.query("select id,name,system_type,is_default,manager_only,cost_based from price_books where store_id=$1 order by sort_order", [storeId]);
  expect(result.rows).toEqual([
    { id: retailId, name: "Giá Chung", system_type: "retail", is_default: true, manager_only: false, cost_based: false },
    { id: costId, name: "Giá vốn", system_type: "cost", is_default: false, manager_only: true, cost_based: true },
    { id: grossId, name: "Giá Chưa Chiết Khấu", system_type: "purchase", is_default: false, manager_only: true, cost_based: false },
    { id: customId, name: "Giá thợ", system_type: null, is_default: false, manager_only: false, cost_based: false },
  ]);
});

test("existing stores missing system books receive exactly the missing types", async () => {
  for (const id of [sparseStoreId, otherStoreId]) {
    const result = await pg.query("select system_type from price_books where store_id=$1 order by system_type", [id]);
    expect(result.rows.map((row) => row.system_type)).toEqual(["cost", "purchase", "retail"]);
  }
});

for (const [kind, id] of [["retail", retailId], ["cost", costId], ["purchase", grossId]]) {
  test(`${kind} book cannot be renamed, reordered, demoted or deleted through SQL`, async () => {
    await expect(pg.query("update price_books set name='Changed' where id=$1", [id])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
    await expect(pg.query("update price_books set sort_order=42 where id=$1", [id])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
    await expect(pg.query("update price_books set system_type=null,is_default=false,cost_based=false,name='Custom' where id=$1", [id])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
    await expect(pg.query("delete from price_books where id=$1", [id])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
  });

  test(`${kind} ignores legacy overrides and blocks inserting or changing them`, async () => {
    await expect(pg.query("insert into product_prices(store_id,price_book_id,product_id,price) values($1,$2,$3,999)", [storeId, id, randomUUID()])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
    await expect(pg.query("update product_prices set price=999 where price_book_id=$1", [id])).rejects.toThrow("SYSTEM_PRICE_BOOK_READ_ONLY");
  });
}

test("a custom price book and its prices remain editable and deletable", async () => {
  const id = randomUUID(), product = randomUUID();
  await pg.query("insert into price_books(id,store_id,name) values($1,$2,'Đại lý')", [id, storeId]);
  await pg.query("update price_books set name='Đại lý cấp 1',sort_order=20 where id=$1", [id]);
  await pg.query("insert into product_prices(store_id,price_book_id,product_id,price) values($1,$2,$3,123)", [storeId, id, product]);
  await pg.query("update product_prices set price=124 where price_book_id=$1", [id]);
  const result = await pg.query("select price from product_prices where price_book_id=$1", [id]);
  expect(result.rows[0].price).toBe("124.00");
  await pg.query("delete from price_books where id=$1", [id]);
  expect((await pg.query("select id from product_prices where price_book_id=$1", [id])).rows).toHaveLength(0);
});

test("reserved names and duplicate source types cannot create extra automatic-looking books", async () => {
  for (const name of ["giá chung", " GIÁ   VỐN ", "Giá Chưa Chiết Khấu"]) {
    await expect(pg.query("insert into price_books(store_id,name) values($1,$2)", [storeId, name])).rejects.toThrow("SYSTEM_PRICE_BOOK_NAME_RESERVED");
  }
  await expect(pg.query("insert into price_books(store_id,name,system_type,cost_based,manager_only) values($1,'Giá vốn','cost',true,true)", [storeId])).rejects.toThrow("price_books_store_system_unique");
});

test("creating a store automatically produces all three locked books", async () => {
  const id = randomUUID();
  await pg.query("insert into stores(id,slug) values($1,'new-store')", [id]);
  const result = await pg.query("select name,system_type from price_books where store_id=$1 order by sort_order", [id]);
  expect(result.rows).toEqual([
    { name: "Giá Chung", system_type: "retail" },
    { name: "Giá vốn", system_type: "cost" },
    { name: "Giá Chưa Chiết Khấu", system_type: "purchase" },
  ]);
});

for (const role of ["owner", "manager", "cashier", "inactive"]) {
  test(`RLS exposes only permitted books and custom prices to ${role}`, async () => {
    const books = await asActor(actors[role], "select id,store_id from price_books order by sort_order");
    const expected = role === "inactive" ? [] : role === "cashier" ? [retailId, customId] : [retailId, costId, grossId, customId];
    expect(books.rows.map((row) => row.id)).toEqual(expected);
    expect(books.rows.every((row) => row.store_id === storeId)).toBe(true);
    const prices = await asActor(actors[role], "select price_book_id from product_prices");
    expect(prices.rows.map((row) => row.price_book_id)).toEqual(role === "inactive" ? [] : [customId]);
  });
}

test("shipping migration preserves old totals, defaults freight to zero, and rejects negative freight", async () => {
  const old = await pg.query("select total,shipping_fee from purchase_orders where id=$1", [oldPurchaseId]);
  expect(old.rows[0]).toEqual({ total: "123.00", shipping_fee: "0.00" });
  await pg.query("update purchase_orders set shipping_fee=17.5 where id=$1", [oldPurchaseId]);
  expect((await pg.query("select shipping_fee from purchase_orders where id=$1", [oldPurchaseId])).rows[0].shipping_fee).toBe("17.50");
  await expect(pg.query("update purchase_orders set shipping_fee=-1 where id=$1", [oldPurchaseId])).rejects.toThrow("purchase_orders_shipping_fee_nonnegative");
  await expect(pg.query("insert into purchase_orders(store_id,shipping_fee) values($1,-1)", [storeId])).rejects.toThrow("purchase_orders_shipping_fee_nonnegative");
});
