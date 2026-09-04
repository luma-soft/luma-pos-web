import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import type { InventoryTransaction } from "./stock-lot-service";
import {
  assertPurchaseCostPeriod, ensureInventoryCostBaselines,
  recordManualInventoryCost, revalueInventoryProducts,
} from "./cost-valuation";
import { getOrderStockRestorations, restoreOrderStockInTransaction } from "./order-stock-restoration";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const store = randomUUID(), otherStore = randomUUID(), warehouse = randomUUID(), supplier = randomUUID();
const basisAt = "2020-01-01T00:00:00.000500Z";
const firstAt = "2020-01-02T00:00:00Z", saleAt = "2020-01-03T00:00:00Z", secondAt = "2020-01-04T00:00:00Z";
const dialect = new PgDialect();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

before(async () => {
  // Actual schema columns and primary keys, with unrelated FK targets omitted.
  const enums = new Set<string>();
  for (const table of [schema.products, schema.stockLevels, schema.stockMovements,
    schema.purchaseOrders, schema.purchaseOrderItems, schema.inventoryCostBaselines,
    schema.inventoryCostAdjustments, schema.returns, schema.productComboItems]) {
    const config = getTableConfig(table);
    for (const column of config.columns) if (column.enumValues?.length && !enums.has(column.getSQLType())) {
      await pg.exec(`create type ${column.getSQLType()} as enum (${column.enumValues.map(quote).join(",")})`);
      enums.add(column.getSQLType());
    }
    const definitions = config.columns.map((column) => {
      const value = column.default;
      const defaultSql = value === undefined ? "" : " default " + (value instanceof SQL ? dialect.sqlToQuery(value).sql
        : typeof value === "boolean" || typeof value === "number" ? String(value)
          : quote(typeof value === "string" ? value : JSON.stringify(value)));
      return `"${column.name}" ${column.getSQLType()}${column.notNull ? " not null" : ""}${defaultSql}${column.primary ? " primary key" : ""}`;
    });
    for (const primaryKey of config.primaryKeys) definitions.push(`primary key (${primaryKey.columns.map((column) => `"${column.name}"`).join(",")})`);
    await pg.exec(`create table "${config.name}" (${definitions.join(",")})`);
  }
  await pg.exec(await readFile(new URL("../../../supabase/denormalize-stock.sql", import.meta.url), "utf8"));
});
after(async () => { await pg.close(); });

const transaction = <T>(callback: (tx: InventoryTransaction) => Promise<T>) => database.transaction((tx) => callback(tx as unknown as InventoryTransaction));

async function product(qty: number, cost: number, gross: number | null = null, tenant = store) {
  const id = randomUUID();
  await database.insert(schema.products).values({ id, storeId: tenant, sku: id.slice(0, 20), name: "Valuation fixture", costPrice: String(cost), lastPurchasePrice: gross == null ? null : String(gross) });
  await database.insert(schema.stockLevels).values({ storeId: tenant, productId: id, warehouseId: warehouse, quantity: String(qty) });
  return id;
}

async function baseline(ids: string[]) {
  await transaction((tx) => ensureInventoryCostBaselines(tx, store, ids));
  await pg.query("update inventory_cost_baselines set effective_at=$1 where store_id=$2 and product_id=any($3::uuid[])", [basisAt, store, ids]);
}

async function changeStock(id: string, amount: number) {
  await pg.query("update stock_levels set quantity=quantity+$1 where store_id=$2 and product_id=$3 and warehouse_id=$4", [amount, store, id, warehouse]);
}

type ReceiptLine = { productId: string; quantity: number; unitCost: number; discount?: number; multiplier?: number };
async function receipt(lines: ReceiptLine[], at: string, header: { discount?: number; vatRate?: number; shippingFee?: number } = {}) {
  const id = randomUUID();
  await database.insert(schema.purchaseOrders).values({
    id, storeId: store, code: id.slice(0, 20), supplierId: supplier, warehouseId: warehouse, status: "received",
    createdAt: new Date(at), costEffectiveAt: new Date(at), discount: String(header.discount ?? 0),
    vatRate: String(header.vatRate ?? 0), shippingFee: String(header.shippingFee ?? 0),
  });
  // SQL retains submillisecond fixture timestamps, unlike Date.
  await pg.query("update purchase_orders set cost_effective_at=$1 where id=$2", [at, id]);
  for (const line of lines) {
    await database.insert(schema.purchaseOrderItems).values({ storeId: store, purchaseOrderId: id,
      productId: line.productId, quantity: String(line.quantity), unitCost: String(line.unitCost),
      discount: String(line.discount ?? 0), unitMultiplier: String(line.multiplier ?? 1),
      total: String(line.quantity * line.unitCost - (line.discount ?? 0)),
    });
    const qty = line.quantity * (line.multiplier ?? 1);
    await movement(line.productId, qty, at, { type: "purchase", refType: "purchase", refId: id, unitCost: line.unitCost });
  }
  return id;
}

async function movement(id: string, qty: number, at: string, input: {
  type?: typeof schema.stockMovements.$inferInsert["type"]; refType?: string; refId?: string; unitCost?: number;
} = {}) {
  await pg.query(`insert into stock_movements(store_id,product_id,warehouse_id,type,quantity,unit_cost,ref_type,ref_id,created_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [store, id, warehouse, input.type ?? "sale", qty,
    input.unitCost ?? null, input.refType ?? "order", input.refId ?? randomUUID(), at]);
  await changeStock(id, qty);
}

async function cancelReceipt(id: string, at = "2020-01-05T00:00:00Z") {
  const lines = await database.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.purchaseOrderId, id));
  await transaction((tx) => assertPurchaseCostPeriod(tx, store, { id, status: "received" }, lines.map((line) => line.productId)));
  await database.update(schema.purchaseOrders).set({ status: "cancelled" }).where(eq(schema.purchaseOrders.id, id));
  for (const line of lines) await movement(line.productId, -Number(line.quantity) * Number(line.unitMultiplier), at,
    { type: "return_out", refType: "purchase_cancel", refId: id });
}

const revalue = (ids: string[], tenant = store) => transaction((tx) => revalueInventoryProducts(tx, tenant, ids));
async function values(id: string) {
  const [row] = await database.select({ qty: schema.products.totalStock, cost: schema.products.costPrice, gross: schema.products.lastPurchasePrice })
    .from(schema.products).where(eq(schema.products.id, id));
  return { qty: Number(row.qty), cost: Number(row.cost), gross: row.gross == null ? null : Number(row.gross) };
}

test("baseline is captured once, including unknown gross, before later product changes", async () => {
  const id = await product(10, 100);
  await transaction((tx) => ensureInventoryCostBaselines(tx, store, [id, id]));
  const original = await database.select().from(schema.inventoryCostBaselines).where(eq(schema.inventoryCostBaselines.productId, id));
  await database.update(schema.products).set({ costPrice: "999" }).where(eq(schema.products.id, id));
  await changeStock(id, 5);
  await transaction((tx) => ensureInventoryCostBaselines(tx, store, [id]));
  assert.deepEqual(await database.select().from(schema.inventoryCostBaselines).where(eq(schema.inventoryCostBaselines.productId, id)), original);
  assert.equal(original[0].quantity, "10.0000");
  assert.equal(original[0].unitCost, "100.00");
  assert.equal(original[0].grossUnitCost, null);
  const untouched = await product(1, 80, 90);
  await revalue([untouched]);
  assert.deepEqual(await values(untouched), { qty: 1, cost: 80, gross: 90 });
});

test("multiline receipt allocates header discount, VAT and freight across all products", async () => {
  const a = await product(10, 100), b = await product(5, 50);
  await baseline([a, b]);
  await receipt([
    { productId: a, quantity: 2, unitCost: 200, discount: 20 },
    { productId: a, quantity: 3, unitCost: 100 },
    { productId: b, quantity: 5, unitCost: 100 },
  ], firstAt, { discount: 118, vatRate: 10, shippingFee: 59 });
  // Revalue A alone: B must still participate in invoice allocation.
  await revalue([a]);
  assert.deepEqual(await values(a), { qty: 15, cost: 113.81, gross: 140 });
  await revalue([b]);
  assert.deepEqual(await values(b), { qty: 10, cost: 76.99, gross: 100 });
});

test("cancel an earlier receipt after an intervening sale and restore latest active gross", async () => {
  const id = await product(20, 100);
  await baseline([id]);
  const first = await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  await movement(id, -10, saleAt);
  const second = await receipt([{ productId: id, quantity: 10, unitCost: 300 }], secondAt);
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 30, cost: 188.89, gross: 300 });
  await cancelReceipt(first);
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 20, cost: 200, gross: 300 });
  await cancelReceipt(second);
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 10, cost: 100, gross: null });
});

test("receipt edits use current lines, ignore reversal audit rows and preserve later prices", async () => {
  const id = await product(10, 100, 90);
  await baseline([id]);
  const first = await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  await movement(id, -10, saleAt);
  await receipt([{ productId: id, quantity: 10, unitCost: 300 }], secondAt);
  await revalue([id]);
  assert.equal((await values(id)).cost, 225);
  await database.update(schema.purchaseOrderItems).set({ quantity: "20", unitCost: "100", total: "2000" })
    .where(eq(schema.purchaseOrderItems.purchaseOrderId, first));
  await movement(id, -10, "2020-01-05T00:00:00Z", { type: "return_out", refType: "purchase_edit", refId: first });
  await movement(id, 20, "2020-01-05T00:00:01Z", { type: "purchase", refType: "purchase_edit", refId: first });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 30, cost: 166.67, gross: 300 });
});

test("converted receipt units divide both gross and landed value into base units", async () => {
  const id = await product(10, 10, 10);
  await baseline([id]);
  await receipt([{ productId: id, quantity: 2, unitCost: 100, multiplier: 5 }], firstAt, { shippingFee: 10 });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 20, cost: 15.5, gross: 20 });
});

test("tenant scopes reject foreign product IDs and ignore foreign movements/receipt headers", async () => {
  const id = await product(0, 10), foreign = await product(8, 777, 800, otherStore);
  await baseline([id]);
  await receipt([{ productId: id, quantity: 2, unitCost: 100 }], firstAt);
  await pg.query("insert into stock_movements(store_id,product_id,warehouse_id,type,quantity,created_at) values($1,$2,$3,'adjust',999,$4)", [otherStore, id, warehouse, saleAt]);
  const foreignReceipt = randomUUID();
  await database.insert(schema.purchaseOrders).values({ id: foreignReceipt, storeId: otherStore, code: "FOREIGN", supplierId: supplier, warehouseId: warehouse, status: "received", costEffectiveAt: new Date(firstAt) });
  await database.insert(schema.purchaseOrderItems).values({ storeId: store, purchaseOrderId: foreignReceipt, productId: id, quantity: "50", unitCost: "999", total: "49950" });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 2, cost: 100, gross: 100 });
  assert.deepEqual(await values(foreign), { qty: 8, cost: 777, gross: 800 });
  await assert.rejects(revalue([foreign]), /COST_PRODUCT_NOT_FOUND/);
  await assert.rejects(transaction((tx) => ensureInventoryCostBaselines(tx, store, [foreign])), /COST_PRODUCT_NOT_FOUND/);
  await assert.rejects(transaction((tx) => recordManualInventoryCost(tx, store, foreign, 1)), /COST_PRODUCT_NOT_FOUND/);
});

test("manual cost overrides remain in replay after earlier receipts are cancelled", async () => {
  const id = await product(10, 100);
  await baseline([id]);
  const first = await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  await revalue([id]);
  await transaction(async (tx) => {
    await recordManualInventoryCost(tx, store, id, 250);
    await tx.update(schema.products).set({ costPrice: "250" }).where(and(eq(schema.products.storeId, store), eq(schema.products.id, id)));
    await recordManualInventoryCost(tx, store, id, 250);
  });
  const adjustments = await database.select().from(schema.inventoryCostAdjustments).where(eq(schema.inventoryCostAdjustments.productId, id));
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].unitCost, "250.00");
  await receipt([{ productId: id, quantity: 10, unitCost: 100 }], "2090-01-01T00:00:00Z");
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 30, cost: 200, gross: 100 });
  await cancelReceipt(first);
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 20, cost: 175, gross: 100 });
});

test("SQL cutoffs distinguish timestamps within one millisecond and allow newly received drafts", async () => {
  const id = await product(10, 100);
  await baseline([id]);
  const old = await receipt([{ productId: id, quantity: 2, unitCost: 999 }], "2020-01-01T00:00:00.000400Z");
  await changeStock(id, -2); // Already represented by the reconciled opening quantity.
  await assert.rejects(transaction((tx) => assertPurchaseCostPeriod(tx, store, { id: old, status: "received" }, [id])), /COST_HISTORY_LOCKED/);
  const current = await receipt([{ productId: id, quantity: 2, unitCost: 200 }], "2020-01-01T00:00:00.000600Z");
  await pg.query("update purchase_orders set created_at='2019-01-01' where id=$1", [current]);
  await transaction((tx) => assertPurchaseCostPeriod(tx, store, { id: current, status: "received" }, [id]));
  // This adjustment predates baseline but shares its JS millisecond.
  await movement(id, -9, "2020-01-01T00:00:00.000450Z", { type: "adjust" });
  await changeStock(id, 9);
  await movement(id, -2, "2020-01-01T00:00:00.000650Z");
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 10, cost: 116.67, gross: 200 });
});

test("customer returns use original replayed sale cost; unknown legacy cost preserves average", async () => {
  const id = await product(10, 100);
  await baseline([id]);
  await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  const order = randomUUID(), returned = randomUUID();
  await movement(id, -10, saleAt, { refId: order });
  await receipt([{ productId: id, quantity: 10, unitCost: 300 }], secondAt);
  await database.insert(schema.returns).values({ id: returned, storeId: store, code: "RETURN", orderId: order });
  await movement(id, 5, "2020-01-05T00:00:00Z", { type: "return_in", refType: "return", refId: returned });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 25, cost: 210, gross: 300 });
  await movement(id, 5, "2020-01-06T00:00:00Z", { type: "return_in", refType: "order_cancel" });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 30, cost: 210, gross: 300 });
  await movement(id, 5, "2020-01-07T00:00:00Z", { type: "return_in", refType: "return", unitCost: 80 });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 35, cost: 191.43, gross: 300 });
  await movement(id, -5, "2020-01-08T00:00:00Z", { type: "return_out", refType: "purchase_return", unitCost: 999 });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 30, cost: 191.43, gross: 300 });
});

test("unexplained stock drift aborts revaluation without replacing the stored price", async () => {
  const id = await product(10, 100, 90);
  await baseline([id]);
  await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  await changeStock(id, 1);
  await assert.rejects(revalue([id]), /COST_LEDGER_MISMATCH/);
  assert.deepEqual(await values(id), { qty: 21, cost: 100, gross: 90 });
});

test("replayed sale cost supersedes a stale return snapshot after receipt edits", async () => {
  const id = await product(10, 100);
  await baseline([id]);
  const first = await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  const order = randomUUID(), returned = randomUUID();
  await movement(id, -10, saleAt, { refType: "exchange_order", refId: order });
  await receipt([{ productId: id, quantity: 10, unitCost: 300 }], secondAt);
  await database.insert(schema.returns).values({ id: returned, storeId: store, code: "REPLAY-RETURN", orderId: order });
  await movement(id, 5, "2020-01-05T00:00:00Z", { type: "return_in", refType: "return", refId: returned, unitCost: 150 });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 25, cost: 210, gross: 300 });
  await database.update(schema.purchaseOrderItems).set({ unitCost: "100", total: "1000" })
    .where(eq(schema.purchaseOrderItems.purchaseOrderId, first));
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 25, cost: 180, gross: 300 });
  await receipt([{ productId: id, quantity: 5, unitCost: 400 }], "2020-01-06T00:00:00Z");
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 30, cost: 216.67, gross: 400 });
  await database.update(schema.returns).set({ status: "cancelled" }).where(eq(schema.returns.id, returned));
  await movement(id, -5, "2020-01-07T00:00:00Z", { type: "return_out", refType: "return_cancel", refId: returned });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 25, cost: 240, gross: 400 });
});

test("order edit cancellation restores original cost and legacy return cancellation changes quantity", async () => {
  const id = await product(10, 100);
  await baseline([id]);
  await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  const order = randomUUID();
  await movement(id, -10, saleAt, { refId: order });
  await receipt([{ productId: id, quantity: 10, unitCost: 300 }], secondAt);
  await movement(id, 10, "2020-01-05T00:00:00Z", { type: "return_in", refType: "order_edit_cancel", refId: order });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 30, cost: 200, gross: 300 });
  const returned = randomUUID();
  await database.insert(schema.returns).values({ id: returned, storeId: store, code: "OLD-RETURN", status: "cancelled" });
  await movement(id, 5, "2019-12-31T00:00:00Z", { type: "return_in", refType: "return", refId: returned, unitCost: 999 });
  await changeStock(id, -5); // The old return is already included in the opening balance.
  await movement(id, -5, "2020-01-06T00:00:00Z", { type: "return_out", refType: "return_cancel", refId: returned });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 25, cost: 200, gross: 300 });
});

test("same-ID order edits replace the original sale cost used by later returns", async () => {
  const id = await product(10, 100), order = randomUUID(), returned = randomUUID();
  await baseline([id]);
  await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  await movement(id, -10, saleAt, { refId: order }); // Original sale cost 150.
  await receipt([{ productId: id, quantity: 10, unitCost: 300 }], secondAt);
  await movement(id, 10, "2020-01-05T00:00:00Z", { type: "return_in", refType: "order_edit_cancel", refId: order });
  await movement(id, -10, "2020-01-05T00:00:01Z", { refId: order }); // Replacement sale cost 200.
  await receipt([{ productId: id, quantity: 10, unitCost: 400 }], "2020-01-06T00:00:00Z");
  await database.insert(schema.returns).values({ id: returned, storeId: store, code: "EDITED-RETURN", orderId: order });
  await movement(id, 10, "2020-01-07T00:00:00Z", { type: "return_in", refType: "return", refId: returned });
  await revalue([id]);
  assert.deepEqual(await values(id), { qty: 40, cost: 250, gross: 400 });
});

test("actual order restoration records only outstanding sales across repeated edits", async () => {
  const id = await product(10, 100), orderId = randomUUID();
  await baseline([id]);
  await receipt([{ productId: id, quantity: 10, unitCost: 200 }], firstAt);
  await movement(id, -5, saleAt, { refId: orderId });
  await receipt([{ productId: id, quantity: 5, unitCost: 300 }], secondAt);
  const order = { id: orderId, warehouseId: warehouse };
  const restore = (refType: "order_cancel" | "order_edit_cancel") => transaction(async (tx) => {
    const targets = await getOrderStockRestorations(tx, store, order, []);
    await restoreOrderStockInTransaction(tx, { storeId: store, orderId, orderCode: "STOCK-EDIT", targets, refType, createdBy: null });
    await revalueInventoryProducts(tx, store, targets.map((target) => target.productId));
    return targets;
  });
  assert.equal((await restore("order_edit_cancel"))[0].quantity, 5);
  assert.deepEqual(await values(id), { qty: 25, cost: 180, gross: 300 });
  const now = (await pg.query<{ at: string }>("select clock_timestamp()::text at")).rows[0].at;
  await movement(id, -8, now, { refId: orderId });
  assert.equal((await restore("order_cancel"))[0].quantity, 8);
  assert.deepEqual(await values(id), { qty: 25, cost: 180, gross: 300 });
  assert.deepEqual(await transaction((tx) => getOrderStockRestorations(tx, store, order, [])), []);
  const restores = (await pg.query<{ quantity: string }>("select quantity from stock_movements where ref_id=$1 and type='return_in' order by created_at", [orderId])).rows;
  assert.deepEqual(restores.map((row) => Number(row.quantity)), [5, 8]);
});

test("legacy restoration expands only physical combo components and excludes services", async () => {
  const component = await product(10, 100), combo = await product(0, 0), service = await product(0, 0);
  await database.update(schema.products).set({ productKind: "combo" }).where(eq(schema.products.id, combo));
  await database.update(schema.products).set({ productKind: "service" }).where(eq(schema.products.id, service));
  await database.insert(schema.productComboItems).values([
    { storeId: store, comboProductId: combo, componentProductId: component, quantity: "2" },
    { storeId: store, comboProductId: combo, componentProductId: service, quantity: "1" },
  ]);
  await baseline([component]);
  const orderId = randomUUID();
  const targets = await transaction(async (tx) => {
    const result = await getOrderStockRestorations(tx, store, { id: orderId, warehouseId: warehouse }, [
      { productId: combo, quantity: "3", unitMultiplier: "2" },
      { productId: service, quantity: "4", unitMultiplier: "1" },
      { productId: component, quantity: "1", unitMultiplier: "1" },
    ]);
    await restoreOrderStockInTransaction(tx, { storeId: store, orderId, orderCode: "LEGACY", targets: result, refType: "order_cancel", createdBy: null });
    await revalueInventoryProducts(tx, store, result.map((target) => target.productId));
    return result;
  });
  assert.deepEqual(targets, [{ productId: component, warehouseId: warehouse, quantity: 13, sourceRefType: "order" }]);
  assert.deepEqual(await values(component), { qty: 23, cost: 100, gross: null });
  assert.equal((await values(combo)).qty, 0);
  assert.equal((await values(service)).qty, 0);
});

test("movement restoration preserves original warehouses and exchange components", async () => {
  const id = await product(20, 100), combo = await product(0, 0), secondWarehouse = randomUUID(), orderId = randomUUID();
  await database.update(schema.products).set({ productKind: "combo" }).where(eq(schema.products.id, combo));
  await database.insert(schema.stockLevels).values({ storeId: store, productId: id, warehouseId: secondWarehouse, quantity: "10" });
  await baseline([id]);
  await movement(id, -3, firstAt, { refId: orderId });
  await pg.query("insert into stock_movements(store_id,product_id,warehouse_id,type,quantity,ref_type,ref_id,created_at) values($1,$2,$3,'sale',-4,'exchange_order',$4,$5)", [store, id, secondWarehouse, orderId, firstAt]);
  await pg.query("update stock_levels set quantity=quantity-4 where product_id=$1 and warehouse_id=$2", [id, secondWarehouse]);
  await pg.query("insert into stock_movements(store_id,product_id,warehouse_id,type,quantity,ref_type,ref_id,created_at) values($1,$2,$3,'sale',-999,'order',$4,$5)", [otherStore, id, warehouse, orderId, firstAt]);
  const targets = await transaction(async (tx) => {
    const result = await getOrderStockRestorations(tx, store, { id: orderId, warehouseId: warehouse }, [
      { productId: combo, quantity: "100", unitMultiplier: "1" },
    ]);
    await restoreOrderStockInTransaction(tx, { storeId: store, orderId, orderCode: "EXCHANGE", targets: result, refType: "order_cancel", createdBy: null });
    await revalueInventoryProducts(tx, store, [id]);
    return result;
  });
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.find((target) => target.warehouseId === secondWarehouse), {
    productId: id, warehouseId: secondWarehouse, quantity: 4, sourceRefType: "exchange_order",
  });
  assert.equal((await values(id)).qty, 30);
  assert.equal((await values(combo)).qty, 0);
});
