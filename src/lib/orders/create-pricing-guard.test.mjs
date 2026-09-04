import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { SQL, sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";

const localTestUrl = process.env.CHECKOUT_TEST_DATABASE_URL;
if (localTestUrl) {
  const target = new URL(localTestUrl);
  if (target.hostname !== "127.0.0.1" || !target.pathname.startsWith("/luma_pricing_test")) throw new Error("Test database must be disposable loopback PostgreSQL");
}
const pg = localTestUrl ? new Client({ connectionString: localTestUrl }) : new PGlite();
if (localTestUrl) pg.exec = (query) => pg.query(query);
const pool = localTestUrl ? new Pool({ connectionString: localTestUrl, max: 4 }) : null;
const database = pool ? nodeDrizzle(pool, { schema }) : drizzle(pg, { schema });
const storeId = randomUUID(), productId = randomUUID(), warehouseId = randomUUID();
const userId = randomUUID(), bookId = randomUUID();
mock.module("@/db", () => ({ db: database }));
mock.module("@/lib/sync/revalidate-app-data", () => ({ revalidateAppData() {} }));
mock.module("@/lib/actions/common", () => ({
  getProfileId: async () => userId, getRole: async () => "owner",
  generateCode: () => randomUUID().slice(0, 24), toMoney: (n) => n.toFixed(2), toQty: (n) => n.toFixed(4),
  isUniqueViolation: (e) => (e?.cause?.code ?? e?.code) === "23505",
  pgErrorCode: (e) => e?.cause?.code ?? e?.code,
}));
mock.module("@/lib/auth/store-context", () => ({ resolveStoreContextForUser: async () => ({ storeId, role: "owner" }) }));
mock.module("@/lib/data/shifts", () => ({ getCurrentShift: async () => null }));
let failAudit = false;
const marker = (kind) => async (tx) => {
  if (kind === "audit" && failAudit) throw Object.assign(new Error("test lock contention"), { code: "55P03" });
  return tx.execute(sql`insert into qa_effects(kind) values (${kind})`);
};
mock.module("@/lib/cash", () => ({ recordCashTx: marker("cash"), fundForMethod: () => "cash" }));
mock.module("@/lib/audit/activity-log", () => ({ recordActivity: marker("audit") }));
mock.module("@/lib/inventory/cost-valuation", () => ({ revalueInventoryProducts: marker("valuation") }));
mock.module("@/lib/inventory/order-stock-restoration", () => ({ getOrderStockRestorations: async () => [], restoreOrderStockInTransaction: marker("restore") }));
mock.module("@/lib/inventory/stock-lot-service", () => ({ consumeTrackedStockLots: marker("stock-lot") }));
mock.module("@/lib/notifications/events-core", () => ({ createNotificationEventInTx: async () => null }));
mock.module("@/lib/notifications/outbox", () => ({ publishCommittedNotification: async () => {} }));
const { createOrderForUser } = await import("./create");
const { normalizeOrderItems } = await import("./normalize");

const dialect = new PgDialect();
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
beforeAll(async () => {
  if (localTestUrl) await pg.connect();
  const enums = new Set();
  for (const table of [schema.products, schema.productUnits, schema.productPrices, schema.priceBooks,
    schema.promotions, schema.productComboItems, schema.purchaseOrders, schema.purchaseOrderItems,
    schema.orders, schema.orderItems, schema.payments, schema.stockLevels, schema.stockMovements,
    schema.catalogSyncState, schema.returns, schema.einvoices, schema.warehouses, schema.categories, schema.brands]) {
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (!column.enumValues?.length || enums.has(column.getSQLType())) continue;
      await pg.exec(`create type ${column.getSQLType()} as enum (${column.enumValues.map(quote).join(",")})`);
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
    await pg.exec(`create table "${config.name}" (${columns.join(",")})`);
  }
  await pg.exec(`create unique index on catalog_sync_state(store_id,id);
    create unique index on stock_levels(store_id,product_id,warehouse_id);
    create unique index on orders(store_id,client_id);
    alter table order_items add foreign key(product_id) references products(id);
    alter table order_items add foreign key(order_id) references orders(id);
    create table qa_effects(kind text);`);
  await database.insert(schema.products).values({ id: productId, storeId, sku: "PIPE", name: "Ống", baseUnit: "m", retailPrice: "10000", productKind: "product" });
  await database.insert(schema.productUnits).values({ storeId, productId, unitName: "cây", multiplier: "4", priceOverride: "45000" });
  await database.insert(schema.priceBooks).values({ id: bookId, storeId, name: "Giá thợ" });
  await database.insert(schema.productPrices).values({ storeId, productId, priceBookId: bookId, price: "8000" });
  await database.insert(schema.catalogSyncState).values({ storeId, id: 1, revision: 7 });
  const original = await readFile("drizzle/0104_tenant_catalog_and_storage.sql", "utf8");
  await pg.exec(original.split("DROP POLICY")[0]);
  await pg.exec(await readFile("drizzle/0130_pricing_catalog_revision.sql", "utf8"));
});
beforeEach(async () => {
  failAudit = false;
  await pg.exec("truncate orders, order_items, payments, stock_levels, stock_movements, qa_effects, promotions");
  await pg.query("update products set retail_price='10000', vat_rate=null where id=$1", [productId]);
  await pg.query("update product_units set multiplier='4', price_override='45000' where product_id=$1", [productId]);
  await pg.query("update catalog_sync_state set revision=7 where store_id=$1", [storeId]);
});
afterAll(async () => {
  if (pool) await pool.end();
  if (localTestUrl) await pg.end(); else await pg.close();
});
const request = (overrides = {}) => ({
  clientId: randomUUID(), warehouseId,
  items: [{ productId, unitName: "cây", quantity: 2 }],
  payment: { method: "cash", amount: 90000 },
  expectedPricing: { version: 1, lines: [{ productId, unitName: "cây", unitMultiplier: 4, unitPrice: 45000 }] },
  ...overrides,
});
const effects = async () => {
  const counts = {};
  for (const table of ["orders", "order_items", "payments", "stock_levels", "stock_movements", "qa_effects"]) {
    counts[table] = Number((await pg.query(`select count(*) as n from ${table}`)).rows[0].n);
  }
  return counts;
};

test("stale checkout rejects before order, cash, stock and audit writes", async () => {
  await pg.query("update product_units set price_override='48000' where product_id=$1", [productId]);
  expect(await createOrderForUser(userId, request())).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
  expect(Object.values(await effects())).toEqual([0, 0, 0, 0, 0, 0]);
});

test("matching checkout preserves selected unit, total, payment and stock", async () => {
  expect((await createOrderForUser(userId, request())).ok).toBe(true);
  const [order] = (await pg.query("select total, amount_paid from orders")).rows;
  expect(order).toEqual({ total: "90000.00", amount_paid: "90000.00" });
  expect((await pg.query("select quantity from stock_levels")).rows[0].quantity).toBe("-8.0000");
});

test("factor changes reject even if the selected unit price is unchanged", async () => {
  await pg.query("update product_units set multiplier='5' where product_id=$1", [productId]);
  expect(await createOrderForUser(userId, request())).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
  expect(Object.values(await effects())).toEqual([0, 0, 0, 0, 0, 0]);
});

test("legacy offline request remains accepted without silently inventing a guard", async () => {
  const input = request(); delete input.expectedPricing;
  expect((await createOrderForUser(userId, input)).ok).toBe(true);
});

test("intentional manual price and discount survive a catalog price change", async () => {
  await pg.query("update product_units set price_override='48000' where product_id=$1", [productId]);
  const input = request({ items: [{ productId, unitName: "cây", quantity: 2, manualUnitPrice: 40000, lineDiscount: 5000 }] });
  input.expectedPricing.lines[0].unitPrice = 35000;
  expect((await createOrderForUser(userId, input)).ok).toBe(true);
  expect((await pg.query("select unit_price, pre_discount_unit_price, discount from order_items")).rows[0])
    .toEqual({ unit_price: "35000.00", pre_discount_unit_price: "40000.00", discount: "10000.00" });
});

test("zero is an acknowledged price, not a missing snapshot", async () => {
  await pg.query("update product_units set price_override=0 where product_id=$1", [productId]);
  const input = request(); input.expectedPricing.lines[0].unitPrice = 0;
  expect((await createOrderForUser(userId, input)).ok).toBe(true);
  expect((await pg.query("select total from orders")).rows[0].total).toBe("0.00");
});

test("new promotion requires acknowledgement of the actual net unit price", async () => {
  await database.insert(schema.promotions).values({ storeId, productId, name: "Sale", tiers: [{ minQty: 1, discountPct: 20 }] });
  expect(await createOrderForUser(userId, request())).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
  expect(Object.values(await effects())).toEqual([0, 0, 0, 0, 0, 0]);
  const input = request(); input.expectedPricing.lines[0].unitPrice = 36000;
  expect((await createOrderForUser(userId, input)).ok).toBe(true);
  expect((await pg.query("select total from orders")).rows[0].total).toBe("72000.00");
});

test("custom-book price changes are checked instead of only retail prices", async () => {
  const input = request({ priceBookId: bookId }); input.expectedPricing.lines[0].unitPrice = 30000;
  expect(await createOrderForUser(userId, input)).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
  input.expectedPricing.lines[0].unitPrice = 36000;
  expect((await createOrderForUser(userId, input)).ok).toBe(true);
});

test("approval values cannot change even when final discounted price is still zero", async () => {
  const input = request({ items: [{ productId, unitName: "cây", quantity: 2, lineDiscountMode: "pct", lineDiscountValue: 100 }] });
  input.expectedPricing.lines[0].unitPrice = 0;
  const items = await normalizeOrderItems(storeId, input.items, undefined, "owner");
  await pg.query("update product_units set price_override=48000 where product_id=$1", [productId]);
  expect(await createOrderForUser(userId, input, { items })).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
  expect(Object.values(await effects())).toEqual([0, 0, 0, 0, 0, 0]);
});

for (const mode of ["quote", "booking", "paymentPending"]) test(`${mode} is fenced before any draft/reservation writes`, async () => {
  await pg.query("update product_units set price_override=48000 where product_id=$1", [productId]);
  const input = request(mode === "paymentPending"
    ? { paymentPending: true, payment: { method: "credit", amount: 0 } }
    : { mode });
  expect(await createOrderForUser(userId, input)).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
  expect(Object.values(await effects())).toEqual([0, 0, 0, 0, 0, 0]);
});

test("stale edit keeps the original sale, payment and stock untouched", async () => {
  const created = await createOrderForUser(userId, request());
  expect(created.ok).toBe(true);
  const before = await effects();
  await pg.query("update product_units set price_override=48000 where product_id=$1", [productId]);
  expect(await createOrderForUser(userId, request({ source: { mode: "edit", orderId: created.data.id } })))
    .toEqual({ ok: false, error: "pos.errors.pricingChanged" });
  expect(await effects()).toEqual(before);
  expect((await pg.query("select status, replaced_by_order_id from orders")).rows[0])
    .toEqual({ status: "completed", replaced_by_order_id: null });
  expect((await pg.query("select quantity from stock_levels")).rows[0].quantity).toBe("-8.0000");
});

test("a lock error after inserts rolls back order, lines, payment and audit", async () => {
  failAudit = true;
  expect(await createOrderForUser(userId, request())).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
  expect(Object.values(await effects())).toEqual([0, 0, 0, 0, 0, 0]);
});

test("missing revision fails closed instead of proceeding without a lock", async () => {
  await pg.query("delete from catalog_sync_state where store_id=$1", [storeId]);
  try {
    expect(await createOrderForUser(userId, request())).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
    expect(Object.values(await effects())).toEqual([0, 0, 0, 0, 0, 0]);
  } finally { await database.insert(schema.catalogSyncState).values({ storeId, id: 1, revision: 7 }); }
});

test("replay returns the same saved order even if catalog prices changed afterward", async () => {
  const input = request();
  const first = await createOrderForUser(userId, input);
  await pg.query("update product_units set price_override=48000 where product_id=$1", [productId]);
  expect(await createOrderForUser(userId, input)).toEqual(first);
  expect((await effects()).orders).toBe(1);
  expect((await effects()).payments).toBe(1);
});

(localTestUrl ? test : test.skip)("concurrent same-client replay waits for the winner and returns exactly its order", async () => {
  await pg.exec(`create function qa_pause_order() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(77007700); return new; end;$$;
    create trigger qa_pause before insert on orders for each row execute function qa_pause_order();`);
  await pg.query("select pg_advisory_lock(77007700)");
  const input = request();
  let first, second;
  try {
    first = createOrderForUser(userId, input);
    let winnerPid;
    const until = Date.now() + 1500;
    while (!winnerPid && Date.now() < until) {
      winnerPid = (await pg.query("select pid from pg_stat_activity where datname=current_database() and query like 'insert into \"orders\"%' and wait_event_type='Lock'")).rows[0]?.pid;
      if (!winnerPid) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(winnerPid).toBeDefined();
    second = createOrderForUser(userId, input);
    let retryBlocked = false;
    while (!retryBlocked && Date.now() < until) {
      retryBlocked = (await pg.query("select exists(select 1 from pg_stat_activity where datname=current_database() and $1::int=any(pg_blocking_pids(pid))) as blocked", [winnerPid])).rows[0].blocked;
      if (!retryBlocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(retryBlocked).toBe(true);
    await pg.query("select pg_advisory_unlock(77007700)");
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true); expect(b).toEqual(a);
    expect((await effects()).orders).toBe(1);
    expect((await effects()).payments).toBe(1);
    expect((await pg.query("select quantity from stock_levels")).rows[0].quantity).toBe("-8.0000");
  } finally {
    await pg.query("select pg_advisory_unlock(77007700)");
    await Promise.allSettled([first, second].filter(Boolean));
    await pg.exec("drop trigger qa_pause on orders; drop function qa_pause_order()");
  }
}, 10000);
