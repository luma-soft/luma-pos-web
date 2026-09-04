// Run in a disposable REAL PostgreSQL database, never DATABASE_URL/production.
// CHECKOUT_TEST_DATABASE_URL must target loopback and a luma_pricing_test* DB.
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { SQL, sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
import { createOrderSchema } from "../schemas/order";

const url = process.env.CHECKOUT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !target.pathname.startsWith("/luma_pricing_test")) {
    throw new Error("Concurrency tests require a disposable loopback luma_pricing_test database");
  }
}
const integration = url ? test : test.skip;
const admin = new Client({ connectionString: url });
const checkout = new Client({ connectionString: url });
const writer = new Client({ connectionString: url });
const database = drizzle(checkout, { schema });
let prepareCheckoutPricing;
if (url) {
  mock.module("@/db", () => ({ db: database }));
  ({ prepareCheckoutPricing } = await import("./checkout-pricing"));
}
const storeId = randomUUID(), otherStoreId = randomUUID();
const productId = randomUUID(), otherProductId = randomUUID(), warehouseId = randomUUID();
let checkoutPid, writerPid;
const dialect = new PgDialect();
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const request = (price = 45000, product = productId) => createOrderSchema.parse({
  warehouseId,
  items: [{ productId: product, unitName: "cây", quantity: 2 }],
  payment: { method: "cash", amount: price * 2 },
  expectedPricing: { version: 1, lines: [{ productId: product, unitName: "cây", unitMultiplier: 4, unitPrice: price }] },
});
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const countOrders = async () => Number((await admin.query("select count(*) as n from qa_orders")).rows[0].n);
async function awaitBlockedWriter() {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const { rows } = await admin.query("select $1::int = any(pg_blocking_pids($2::int)) as blocked", [checkoutPid, writerPid]);
    if (rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("writer did not block on the checkout's real PostgreSQL lock");
}
beforeAll(async () => {
  if (!url) return;
  await Promise.all([admin.connect(), checkout.connect(), writer.connect()]);
  checkoutPid = (await checkout.query("select pg_backend_pid() as pid")).rows[0].pid;
  writerPid = (await writer.query("select pg_backend_pid() as pid")).rows[0].pid;
  expect(checkoutPid).not.toBe(writerPid);
  const enums = new Set();
  for (const table of [schema.products, schema.productUnits, schema.productPrices, schema.priceBooks,
    schema.promotions, schema.productComboItems, schema.purchaseOrders, schema.purchaseOrderItems,
    schema.catalogSyncState, schema.stockLevels, schema.warehouses, schema.categories, schema.brands]) {
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (!column.enumValues?.length || enums.has(column.getSQLType())) continue;
      await admin.query(`create type ${column.getSQLType()} as enum (${column.enumValues.map(quote).join(",")})`);
      enums.add(column.getSQLType());
    }
    const columns = config.columns.map((column) => {
      const value = column.default;
      const defaultSql = value === undefined ? "" : " default " + (value instanceof SQL
        ? dialect.sqlToQuery(value).sql
        : typeof value === "boolean" || typeof value === "number" ? String(value)
          : quote(typeof value === "string" ? value : JSON.stringify(value)));
      return `"${column.name}" ${column.getSQLType()}${column.notNull ? " not null" : ""}${defaultSql}${column.primary ? " primary key" : ""}`;
    });
    await admin.query(`create table "${config.name}" (${columns.join(",")})`);
  }
  await admin.query("create unique index on catalog_sync_state(store_id,id); create table qa_orders(store_id uuid, unit_price numeric)");
  const original = await readFile("drizzle/0104_tenant_catalog_and_storage.sql", "utf8");
  await admin.query(original.split("DROP POLICY")[0]);
  await admin.query(await readFile("drizzle/0130_pricing_catalog_revision.sql", "utf8"));
  for (const [store, product] of [[storeId, productId], [otherStoreId, otherProductId]]) {
    await admin.query("insert into products(id,store_id,sku,name,base_unit,retail_price) values($1,$2,$3,'Pipe','m',10000)", [product, store, product]);
    await admin.query("insert into product_units(store_id,product_id,unit_name,multiplier,price_override) values($1,$2,'cây',4,45000)", [store, product]);
  }
}, 15000);
beforeEach(async () => {
  if (!url) return;
  await admin.query("truncate qa_orders; update product_units set price_override=45000,multiplier=4; update products set retail_price=10000");
});
afterAll(async () => { if (url) await Promise.allSettled([admin.end(), checkout.end(), writer.end()]); });

integration("writer-first committed price change rejects checkout without a business write", async () => {
  await writer.query("update product_units set price_override=48000 where product_id=$1", [productId]);
  await expect(database.transaction(async (tx) => {
    await prepareCheckoutPricing(tx, storeId, request(), "owner");
    await tx.execute(sql`insert into qa_orders values (${storeId},45000)`);
  }, { isolationLevel: "read committed" })).rejects.toThrow("pos.errors.pricingChanged");
  expect(await countOrders()).toBe(0);
});

integration("checkout-first fence blocks the competing price writer until order commit", async () => {
  const fenced = deferred(), release = deferred();
  const placing = database.transaction(async (tx) => {
    const { items } = await prepareCheckoutPricing(tx, storeId, request(), "owner");
    fenced.resolve(); await release.promise;
    await tx.execute(sql`insert into qa_orders values (${storeId},${items[0].unitPrice})`);
  }, { isolationLevel: "read committed" });
  await fenced.promise;
  let changing;
  try {
    changing = writer.query("update product_units set price_override=48000 where product_id=$1", [productId]);
    await awaitBlockedWriter();
    expect(await countOrders()).toBe(0);
  } finally { release.resolve(); await placing; await changing; }
  expect((await admin.query("select unit_price from qa_orders")).rows[0].unit_price).toBe("45000");
  expect((await admin.query("select price_override from product_units where product_id=$1", [productId])).rows[0].price_override).toBe("48000.00");
});

integration("a commit between revision read and price reads is rejected even when the expected price matches", async () => {
  const originalQuery = checkout.query.bind(checkout);
  let injected = false;
  checkout.query = async (...args) => {
    const result = await originalQuery(...args);
    const text = typeof args[0] === "string" ? args[0] : args[0].text;
    if (!injected && text.includes('from "catalog_sync_state"') && !text.includes("for update")) {
      injected = true;
      await writer.query("update product_units set price_override=48000 where product_id=$1", [productId]);
    }
    return result;
  };
  try {
    await expect(database.transaction(async (tx) => {
      await prepareCheckoutPricing(tx, storeId, request(48000), "owner");
      await tx.execute(sql`insert into qa_orders values (${storeId},48000)`);
    }, { isolationLevel: "read committed" })).rejects.toThrow("pos.errors.pricingChanged");
    expect(injected).toBe(true);
    expect(await countOrders()).toBe(0);
  } finally { checkout.query = originalQuery; }
});

integration("an uncommitted revision owner makes NOWAIT reject instead of using old prices", async () => {
  await writer.query("begin");
  try {
    await writer.query("update product_units set price_override=48000 where product_id=$1", [productId]);
    let failure;
    try { await database.transaction((tx) => prepareCheckoutPricing(tx, storeId, request(), "owner")); }
    catch (error) { failure = error.cause?.code ?? error.code; }
    expect(failure).toBe("55P03");
    expect(await countOrders()).toBe(0);
  } finally { await writer.query("rollback"); }
});

integration("lock inversion rolls back every checkout write and releases the price writer", async () => {
  const fenced = deferred(), attemptWrite = deferred();
  const placing = database.transaction(async (tx) => {
    await prepareCheckoutPricing(tx, storeId, request(), "owner");
    await tx.execute(sql`insert into qa_orders values (${storeId},45000)`);
    fenced.resolve(); await attemptWrite.promise;
    await tx.execute(sql`set local lock_timeout = '100ms'`);
    await tx.execute(sql`update products set retail_price=retail_price where id=${productId}`);
  }).then(() => null, (error) => error.cause?.code ?? error.code);
  await fenced.promise;
  const changing = writer.query("update products set retail_price=12000 where id=$1", [productId]);
  try { await awaitBlockedWriter(); } finally { attemptWrite.resolve(); }
  expect(await placing).toBe("55P03");
  await changing;
  expect(await countOrders()).toBe(0);
});

integration("another store can checkout while the first store's fence is held", async () => {
  const fenced = deferred(), release = deferred();
  const first = database.transaction(async (tx) => {
    await prepareCheckoutPricing(tx, storeId, request(), "owner");
    fenced.resolve(); await release.promise;
  });
  await fenced.promise;
  try {
    await drizzle(writer, { schema }).transaction(async (tx) => {
      await prepareCheckoutPricing(tx, otherStoreId, request(45000, otherProductId), "owner");
      await tx.execute(sql`insert into qa_orders values (${otherStoreId},45000)`);
    });
    expect(await countOrders()).toBe(1);
  } finally { release.resolve(); await first; }
});
