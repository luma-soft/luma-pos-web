import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID(), userId = randomUUID(), supplierId = randomUUID(), warehouseId = randomUUID();
const basisAt = "2020-01-01T00:00:00.000500Z";
// Keep action schemas, common money/quantity helpers, stock, costs, shifts and
// transactional activity logging real. Only request/external boundaries differ.
mock.module("@/db", () => ({ db: database }));
mock.module("@/lib/auth/store-context", () => ({
  requireStoreContext: async () => ({ storeId, userId, role: "owner", features: {} }),
  getAuthenticatedUser: async () => ({ id: userId }),
  resolveStoreContextForUser: async () => ({ storeId, userId, role: "owner", features: {} }),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
mock.module("@/lib/sync/revalidate-app-data", () => ({ revalidateAppData: () => {} }));
mock.module("@/lib/cash", () => ({ recordCashTx: async () => {} }));
mock.module("@/lib/notifications/events-core", () => ({
  createDebtChangedEventInTx: async () => ({ created: false }),
  createNotificationEventInTx: async () => ({ created: false }),
}));
mock.module("@/lib/notifications/outbox", () => ({ publishCommittedNotification: async () => {} }));
const { createPurchase, updatePurchase, cancelPurchase } = await import("./purchases");

const tables = [schema.products, schema.productSuppliers, schema.purchaseOrders,
  schema.purchaseOrderItems, schema.stockLevels, schema.stockLots, schema.stockLotMovements,
  schema.stockMovements, schema.inventoryCostBaselines, schema.inventoryCostAdjustments,
  schema.returns, schema.profiles, schema.shifts, schema.suppliers, schema.auditLogs];
const dialect = new PgDialect();
const quote = value => `'${value.replaceAll("'", "''")}'`;
beforeAll(async () => {
  // Real schema columns/defaults/PKs; unrelated foreign-key targets are omitted.
  const enums = new Set();
  for (const table of tables) {
    const config = getTableConfig(table);
    for (const column of config.columns) if (column.enumValues?.length && !enums.has(column.getSQLType())) {
      await pg.exec(`create type ${column.getSQLType()} as enum (${column.enumValues.map(quote).join(",")})`);
      enums.add(column.getSQLType());
    }
    const definitions = config.columns.map(column => {
      const value = column.default;
      const defaultSql = value === undefined ? "" : " default " + (value instanceof SQL ? dialect.sqlToQuery(value).sql
        : typeof value === "boolean" || typeof value === "number" ? String(value)
          : quote(typeof value === "string" ? value : JSON.stringify(value)));
      return `"${column.name}" ${column.getSQLType()}${column.notNull ? " not null" : ""}${defaultSql}${column.primary ? " primary key" : ""}`;
    });
    for (const key of config.primaryKeys) definitions.push(`primary key (${key.columns.map(column => `"${column.name}"`).join(",")})`);
    await pg.exec(`create table "${config.name}" (${definitions.join(",")})`);
  }
  await pg.exec("create unique index fixture_product_supplier on product_suppliers(product_id,supplier_id)");
  await pg.exec(await readFile(new URL("../../../supabase/denormalize-stock.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await pg.exec(`truncate ${tables.map(table => `"${getTableConfig(table).name}"`).join(",")}`);
  await database.insert(schema.profiles).values({ id: userId, storeId, fullName: "Cost test owner", role: "owner" });
  await database.insert(schema.suppliers).values({ id: supplierId, storeId, code: "NCC-COST", name: "Cost test supplier", currentDebt: "0" });
});
afterAll(async () => { await pg.close(); });

async function product(quantity = 10, cost = 100, gross = null) {
  const id = randomUUID();
  await database.insert(schema.products).values({ id, storeId, sku: id.slice(0, 20), name: "Receipt cost fixture",
    supplierId, costPrice: String(cost), lastPurchasePrice: gross == null ? null : String(gross), retailPrice: "999" });
  await database.insert(schema.stockLevels).values({ storeId, productId: id, warehouseId, quantity: String(quantity) });
  await database.insert(schema.inventoryCostBaselines).values({ storeId, productId: id, quantity: String(quantity), unitCost: String(cost), grossUnitCost: gross == null ? null : String(gross) });
  await pg.query("update inventory_cost_baselines set effective_at=$1 where product_id=$2", [basisAt, id]);
  return id;
}
const payload = (productId, quantity, unitCost, extra = {}) => ({ supplierId, warehouseId,
  discount: 0, vatRate: 0, shippingFee: 0, amountPaid: 0,
  items: [{ productId, quantity, unitCost, discount: 0 }], ...extra });
async function values(id) {
  const row = (await pg.query("select total_stock,cost_price,last_purchase_price,retail_price from products where id=$1", [id])).rows[0];
  return { quantity: Number(row.total_stock), cost: Number(row.cost_price), gross: row.last_purchase_price == null ? null : Number(row.last_purchase_price), retail: Number(row.retail_price) };
}
async function state() {
  const result = {};
  for (const table of tables) {
    const name = getTableConfig(table).name;
    result[name] = (await pg.query(`select to_jsonb(t) as row from "${name}" t order by to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function legacyReceipt() {
  const productId = await product(40, 197824, 87382), id = randomUUID(), lineId = randomUUID();
  // KiotViet stores net unit cost + per-unit discount, with its original VND
  // rounding. A native recalculation would yield a different financial total.
  await database.insert(schema.purchaseOrders).values({ id, storeId, code: "PN-LEGACY", supplierId, warehouseId,
    status: "received", subtotal: "541768", total: "541768", createdAt: new Date("2019-12-31T00:00:00Z") });
  await database.insert(schema.purchaseOrderItems).values({ id: lineId, storeId, purchaseOrderId: id,
    productId, sku: "LEGACY-SOURCE", unitName: "Thùng", unitMultiplier: "4", quantity: "10",
    unitCost: "54176.84", discount: "33205.16", total: "541768" });
  await pg.query("update suppliers set current_debt=541768 where id=$1", [supplierId]);
  return { id, lineId, productId, input: { id, ...payload(productId, 10, 54176.84,
    { items: [{ productId, quantity: 10, unitCost: 54176.84, discount: 33205.16 }] }) } };
}
async function received(input) {
  const result = await createPurchase(input);
  expect(result.ok).toBe(true);
  return result.data.id;
}

test("pre-baseline imported receipt metadata updates preserve original lines, stock and rounding", async () => {
  const fixture = await legacyReceipt();
  const before = await state();
  const result = await updatePurchase({ ...fixture.input, note: "Đã đối soát", invoiceNumber: "VAT-123" });
  expect(result.ok).toBe(true);
  const after = await state();
  for (const table of ["products", "purchase_order_items", "stock_levels", "stock_movements", "stock_lots", "inventory_cost_baselines", "inventory_cost_adjustments", "suppliers"]) expect(after[table]).toEqual(before[table]);
  const row = (await pg.query("select subtotal,total,discount,tax,shipping_fee,note,invoice_number from purchase_orders where id=$1", [fixture.id])).rows[0];
  expect(row).toEqual({ subtotal: "541768.00", total: "541768.00", discount: "0.00", tax: "0.00", shipping_fee: "0.00", note: "Đã đối soát", invoice_number: "VAT-123" });
  expect((await pg.query("select action from audit_logs")).rows).toEqual([{ action: "purchase.updated" }]);
});

test("pre-baseline quantity/value edits and cancellation reject atomically", async () => {
  const fixture = await legacyReceipt();
  const before = await state();
  for (const item of [
    { ...fixture.input.items[0], quantity: 11 },
    { ...fixture.input.items[0], unitCost: 55000 },
  ]) {
    expect(await updatePurchase({ ...fixture.input, items: [item] })).toEqual({ ok: false, error: "purchases.errors.costHistoryLocked" });
    expect(await state()).toEqual(before);
  }
  expect(await cancelPurchase(fixture.id)).toEqual({ ok: false, error: "purchases.errors.costHistoryLocked" });
  expect(await state()).toEqual(before);
});

test("new receipt create and edit recalculate average and gross through real actions", async () => {
  const productId = await product();
  const input = payload(productId, 10, 200, { discount: 180, vatRate: 10, shippingFee: 18,
    items: [{ productId, quantity: 10, unitCost: 200, discount: 200 }] });
  const id = await received(input);
  // (2,000 − 200 line − 180 invoice) × 1.10 + 18 freight = 1,800.
  // Opening value 1,000 + landed receipt 1,800 over 20 units = 140.
  expect(await values(productId)).toEqual({ quantity: 20, cost: 140, gross: 200, retail: 999 });
  expect((await pg.query("select subtotal,tax,shipping_fee,total from purchase_orders where id=$1", [id])).rows[0])
    .toEqual({ subtotal: "1800.00", tax: "162.00", shipping_fee: "18.00", total: "1800.00" });
  expect((await updatePurchase({ id, ...payload(productId, 20, 150) })).ok).toBe(true);
  expect(await values(productId)).toEqual({ quantity: 30, cost: 133.33, gross: 150, retail: 999 });
  expect((await pg.query("select quantity,unit_cost,discount,total from purchase_order_items where purchase_order_id=$1", [id])).rows)
    .toEqual([{ quantity: "20.0000", unit_cost: "150.00", discount: "0.00", total: "3000.00" }]);
  expect((await pg.query("select count(*)::int as n from stock_movements")).rows[0].n).toBe(3);
});

test("cancelling an earlier post-baseline receipt after a sale replays later receipt costs", async () => {
  const productId = await product(20, 100, 90);
  const first = await received(payload(productId, 10, 200));
  await pg.query("update purchase_orders set cost_effective_at='2020-01-02T00:00:00Z' where id=$1", [first]);
  // A real persisted sale movement sits between the two received documents.
  await database.transaction(async tx => {
    await tx.insert(schema.stockMovements).values({ storeId, productId, warehouseId, type: "sale", quantity: "-10", refType: "order", refId: randomUUID(), createdAt: new Date("2020-01-03T00:00:00Z") });
    await tx.update(schema.stockLevels).set({ quantity: sql`${schema.stockLevels.quantity} - 10` }).where(eq(schema.stockLevels.productId, productId));
  });
  const second = await received(payload(productId, 10, 300));
  await pg.query("update purchase_orders set cost_effective_at='2020-01-04T00:00:00Z' where id=$1", [second]);
  expect(await values(productId)).toEqual({ quantity: 30, cost: 188.89, gross: 300, retail: 999 });
  expect((await cancelPurchase(first)).ok).toBe(true);
  expect(await values(productId)).toEqual({ quantity: 20, cost: 200, gross: 300, retail: 999 });
  expect((await cancelPurchase(second)).ok).toBe(true);
  expect(await values(productId)).toEqual({ quantity: 10, cost: 100, gross: 90, retail: 999 });
  expect((await pg.query("select status from purchase_orders order by code")).rows).toEqual([{ status: "cancelled" }, { status: "cancelled" }]);
});
