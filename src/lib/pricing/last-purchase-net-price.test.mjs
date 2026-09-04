import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { products } from "../../db/schema";
import { lastPurchaseNetPriceSql } from "./last-purchase-net-price";

const pg = new PGlite();
const database = drizzle(pg);
const storeId = randomUUID(), otherStoreId = randomUUID();
const productId = randomUUID(), secondId = randomUUID();

beforeAll(async () => {
  await pg.exec(`
    create table products (id uuid primary key, store_id uuid not null);
    create table purchase_orders (id uuid primary key, store_id uuid not null, status text not null,
      discount numeric not null default 0, tax_amount numeric not null default 0,
      shipping_fee numeric not null default 0, cost_effective_at timestamptz,
      created_at timestamptz not null);
    create table purchase_order_items (id uuid primary key default gen_random_uuid(), store_id uuid not null,
      purchase_order_id uuid not null, product_id uuid not null, quantity numeric not null,
      unit_multiplier numeric not null default 1, total numeric not null);
  `);
  await pg.query("insert into products values ($1, $2), ($3, $2)", [productId, storeId, secondId]);
});
beforeEach(async () => { await pg.exec("truncate purchase_order_items, purchase_orders"); });
afterAll(async () => { await pg.close(); });

async function receipt({ status = "received", store = storeId, createdAt = "2026-09-01", effectiveAt = createdAt, discount = 0, tax = 0, freight = 0, items = [{ product: productId, quantity: 1, total: 100 }] } = {}) {
  const id = randomUUID();
  await pg.query("insert into purchase_orders (id, store_id, status, discount, tax_amount, shipping_fee, cost_effective_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, store, status, discount, tax, freight, effectiveAt, createdAt]);
  for (const item of items) {
    await pg.query("insert into purchase_order_items (store_id, purchase_order_id, product_id, quantity, unit_multiplier, total) values ($1,$2,$3,$4,$5,$6)",
      [item.store ?? store, id, item.product, item.quantity, item.multiplier ?? 1, item.total]);
  }
  return id;
}

async function price(product = productId, store = storeId) {
  const [row] = await database.select({ price: lastPurchaseNetPriceSql(store) }).from(products).where(eq(products.id, product));
  return row.price == null ? null : Number(row.price);
}

test("latest received effective date wins over later drafts, cancellations and backdated entries", async () => {
  await receipt({ createdAt: "2026-08-01", items: [{ product: productId, quantity: 1, total: 100 }] });
  await receipt({ createdAt: "2026-08-20", effectiveAt: "2026-09-02", items: [{ product: productId, quantity: 1, total: 80 }] });
  await receipt({ createdAt: "2026-09-04", effectiveAt: "2026-08-15", items: [{ product: productId, quantity: 1, total: 95 }] });
  await receipt({ createdAt: "2026-09-05", status: "draft", items: [{ product: productId, quantity: 1, total: 10 }] });
  await receipt({ createdAt: "2026-09-06", status: "cancelled", items: [{ product: productId, quantity: 1, total: 20 }] });
  expect(await price()).toBe(80);
});

test("legacy received orders without an effective date use their creation date", async () => {
  await receipt({ createdAt: "2026-09-01", items: [{ product: productId, quantity: 1, total: 100 }] });
  await receipt({ createdAt: "2026-09-03", effectiveAt: null, items: [{ product: productId, quantity: 1, total: 60 }] });
  expect(await price()).toBe(60);
});

test("recorded line totals and proportional invoice discount define the net price before tax and freight", async () => {
  // Company 100 x 10 minus line discount 30% = 700; other line = 300.
  // Invoice discount 100 allocates 70 and 30. Net unit prices: 630/10 and 270/5.
  await receipt({ discount: 100, tax: 90, freight: 250, items: [
    { product: productId, quantity: 10, total: 700 },
    { product: secondId, quantity: 5, total: 300 },
  ] });
  expect(await price()).toBe(63);
  expect(await price(secondId)).toBe(54);
});

test("repeated SKU rows are weighted by quantity after conversion to the base unit", async () => {
  // Two boxes of 10 cost 1,200; five loose units cost 400: 1,600/25 = 64.
  await receipt({ items: [
    { product: productId, quantity: 2, multiplier: 10, total: 1200 },
    { product: productId, quantity: 5, multiplier: 1, total: 400 },
  ] });
  expect(await price()).toBe(64);
});

test("zero received value is valid while no received history remains missing", async () => {
  expect(await price()).toBeNull();
  await receipt({ items: [{ product: productId, quantity: 2, total: 0 }] });
  expect(await price()).toBe(0);
  expect(await price(secondId)).toBeNull();
});

test("discount cannot produce a negative net price", async () => {
  await receipt({ discount: 150, items: [{ product: productId, quantity: 1, total: 100 }] });
  expect(await price()).toBe(0);
});

test("another store's receipts and mismatched receipt items cannot influence the price", async () => {
  await receipt({ items: [{ product: productId, quantity: 1, total: 80 }] });
  await receipt({ store: otherStoreId, createdAt: "2026-09-02", items: [{ product: productId, quantity: 1, total: 10 }] });
  await receipt({ store: otherStoreId, createdAt: "2026-09-03", items: [{ store: storeId, product: productId, quantity: 1, total: 20 }] });
  expect(await price()).toBe(80);
});

test("invoice discount allocation excludes lines belonging to another store", async () => {
  await receipt({ discount: 20, items: [
    { product: productId, quantity: 1, total: 100 },
    { store: otherStoreId, product: secondId, quantity: 1, total: 900 },
  ] });
  expect(await price()).toBe(80);
});

test("editing and cancelling a receipt immediately recomputes the price", async () => {
  const olderId = await receipt({ createdAt: "2026-08-01", items: [{ product: productId, quantity: 1, total: 100 }] });
  const latestId = await receipt({ createdAt: "2026-09-01", items: [{ product: productId, quantity: 2, total: 160 }] });
  expect(await price()).toBe(80);
  await pg.query("update purchase_order_items set total = 140 where purchase_order_id = $1", [latestId]);
  await pg.query("update purchase_orders set discount = 20 where id = $1", [latestId]);
  expect(await price()).toBe(60);
  await pg.query("update purchase_orders set status = 'cancelled' where id = $1", [latestId]);
  expect(await price()).toBe(100);
  await pg.query("update purchase_orders set status = 'cancelled' where id = $1", [olderId]);
  expect(await price()).toBeNull();
});
