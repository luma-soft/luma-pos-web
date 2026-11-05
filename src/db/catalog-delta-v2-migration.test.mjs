import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();
const storeId = "10000000-0000-4000-8000-000000000001";
const otherStoreId = "10000000-0000-4000-8000-000000000002";
const productId = "20000000-0000-4000-8000-000000000001";
const orderId = "30000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  await pg.exec(`
    create table public.stores(id uuid primary key);
    create table public.catalog_sync_state(store_id uuid not null, id integer not null, revision bigint not null, updated_at timestamptz not null, primary key(store_id,id));
    create table public.catalog_delta_floors(store_id uuid primary key, floor_revision bigint not null);
    create table public.catalog_delta_events(store_id uuid not null, revision bigint not null, product_id uuid, requires_full boolean not null default false, changed_at timestamptz not null default now(), primary key(store_id,revision));
    create table public.products(id uuid primary key, store_id uuid not null, name text);
    create table public.product_units(id uuid primary key, store_id uuid not null, product_id uuid);
    create table public.product_prices(id uuid primary key, store_id uuid not null, product_id uuid, price_book_id uuid);
    create table public.stock_levels(id uuid primary key, store_id uuid not null, product_id uuid, warehouse_id uuid);
    create table public.product_combo_items(id uuid primary key, store_id uuid not null, combo_product_id uuid, component_product_id uuid);
    create table public.product_suppliers(id uuid primary key, store_id uuid not null, product_id uuid, supplier_id uuid);
    create table public.product_media(id uuid primary key, store_id uuid not null, product_id uuid, media_object_id uuid);
    create table public.media_objects(id uuid primary key, store_id uuid not null, purpose text, target_id uuid);
    create table public.categories(id uuid primary key, store_id uuid not null, name text);
    create table public.brands(id uuid primary key, store_id uuid not null, name text);
    create table public.suppliers(id uuid primary key, store_id uuid not null, name text);
    create table public.warehouses(id uuid primary key, store_id uuid not null, name text, is_default boolean not null default false);
    create table public.product_variant_groups(id uuid primary key, store_id uuid not null);
    create table public.product_variant_members(id uuid primary key, store_id uuid not null, group_id uuid, product_id uuid);
    create table public.orders(id uuid primary key, store_id uuid not null, status text, created_at timestamptz not null default now());
    create table public.order_items(id uuid primary key, store_id uuid not null, order_id uuid, product_id uuid);
    create table public.purchase_orders(id uuid primary key, store_id uuid not null, status text);
    create table public.purchase_order_items(id uuid primary key, store_id uuid not null, purchase_order_id uuid, product_id uuid);
    create table public.price_books(id uuid primary key, store_id uuid not null);
    create table public.promotions(id uuid primary key, store_id uuid not null);
    insert into public.stores values ('${storeId}'), ('${otherStoreId}');
    insert into public.catalog_sync_state values ('${storeId}', 1, 10, now()), ('${otherStoreId}', 1, 25, now());
  `);

  await pg.exec(await readFile("drizzle/0149_catalog_delta_v2.sql", "utf8"));
  for (const table of [
    "products", "product_units", "product_prices", "stock_levels", "product_combo_items",
    "product_suppliers", "product_media", "media_objects", "categories", "brands", "suppliers",
    "warehouses", "product_variant_groups", "product_variant_members", "order_items",
    "purchase_order_items", "price_books", "promotions",
  ]) {
    await pg.exec(`create trigger ${table}_catalog_revision_test after insert or update or delete on public.${table} for each row execute function public.bump_product_catalog_revision()`);
  }
});

afterAll(async () => pg.close());

const latestEvent = async (store = storeId) => (await pg.query(
  "select revision, product_id, requires_full, change_kind, entity_type, entity_id, affected_product_ids, requires_full_v2 from public.catalog_delta_events where store_id=$1 order by revision desc limit 1",
  [store],
)).rows[0];

test("product and stock writes retain product-level tombstone IDs", async () => {
  await pg.query("insert into public.products(id,store_id,name) values($1,$2,'P')", [productId, storeId]);
  let event = await latestEvent();
  expect(event.change_kind).toBe("product");
  expect(event.product_id).toBe(productId);
  expect(event.affected_product_ids).toEqual([productId]);
  expect(event.requires_full_v2).toBe(false);

  const stockId = "40000000-0000-4000-8000-000000000001";
  const warehouseId = "50000000-0000-4000-8000-000000000001";
  await pg.query("insert into public.stock_levels(id,store_id,product_id,warehouse_id) values($1,$2,$3,$4)", [stockId, storeId, productId, warehouseId]);
  event = await latestEvent();
  expect(event.change_kind).toBe("stock");
  expect(event.affected_product_ids).toEqual([productId]);

  await pg.query("delete from public.products where id=$1", [productId]);
  event = await latestEvent();
  expect(event.change_kind).toBe("product");
  expect(event.product_id).toBe(productId);
});

test("metadata and order changes are targeted in V2 while V1 remains fail-safe", async () => {
  const categoryId = "60000000-0000-4000-8000-000000000001";
  await pg.query("insert into public.categories(id,store_id,name) values($1,$2,'Old')", [categoryId, storeId]);
  let event = await latestEvent();
  expect(event.requires_full).toBe(true);
  expect(event.requires_full_v2).toBe(false);
  expect(event.change_kind).toBe("metadata");
  expect(event.entity_type).toBe("categories");

  await pg.query("insert into public.products(id,store_id,name) values($1,$2,'Sale product')", [productId, storeId]);
  await pg.query("insert into public.orders(id,store_id,status) values($1,$2,'draft')", [orderId, storeId]);
  const lineId = "70000000-0000-4000-8000-000000000001";
  await pg.query("insert into public.order_items(id,store_id,order_id,product_id) values($1,$2,$3,$4)", [lineId, storeId, orderId, productId]);
  event = await latestEvent();
  expect(event.change_kind).toBe("sale");
  expect(event.affected_product_ids).toEqual([productId]);
  expect(event.requires_full_v2).toBe(false);

  await pg.query("update public.orders set status='completed' where id=$1", [orderId]);
  event = await latestEvent();
  expect(event.change_kind).toBe("sale");
  expect(event.affected_product_ids).toEqual([productId]);
});

test("journal writes roll back with the business transaction and stay tenant-local", async () => {
  const before = Number((await pg.query("select revision from public.catalog_sync_state where store_id=$1", [storeId])).rows[0].revision);
  const eventCount = Number((await pg.query("select count(*) from public.catalog_delta_events where store_id=$1", [storeId])).rows[0].count);
  await pg.exec("begin");
  await pg.query("insert into public.products(id,store_id,name) values($1,$2,'Rolled back')", ["80000000-0000-4000-8000-000000000001", storeId]);
  await pg.exec("rollback");
  expect(Number((await pg.query("select revision from public.catalog_sync_state where store_id=$1", [storeId])).rows[0].revision)).toBe(before);
  expect(Number((await pg.query("select count(*) from public.catalog_delta_events where store_id=$1", [storeId])).rows[0].count)).toBe(eventCount);

  await pg.query("insert into public.products(id,store_id,name) values($1,$2,'Other tenant')", ["90000000-0000-4000-8000-000000000001", otherStoreId]);
  expect(Number((await pg.query("select revision from public.catalog_sync_state where store_id=$1", [otherStoreId])).rows[0].revision)).toBe(26);
  expect(Number((await pg.query("select revision from public.catalog_sync_state where store_id=$1", [storeId])).rows[0].revision)).toBe(before);
});
