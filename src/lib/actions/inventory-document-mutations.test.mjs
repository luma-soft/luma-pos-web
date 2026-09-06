import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";
const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID(), userId = randomUUID(), supplierId = randomUUID(), warehouseId = randomUUID();
let allowed = true;
let role = "owner";
mock.module("@/db", () => ({ db: database }));
mock.module("@/lib/auth/store-context", () => ({
  requireStoreContext: async () => ({ storeId, userId, role: allowed ? role : "cashier", features: {} }),
  getAuthenticatedUser: async () => ({ id: userId }),
  resolveStoreContextForUser: async () => ({ storeId, userId, role: allowed ? role : "cashier", features: {} }),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
mock.module("@/lib/sync/revalidate-app-data", () => ({ revalidateAppData: () => {} }));
mock.module("@/lib/notifications/events-core", () => ({ createDebtChangedEventInTx: async () => null }));
mock.module("@/lib/notifications/outbox", () => ({ publishCommittedNotification: async () => {} }));
const { createPurchaseReturn, updatePurchaseReturn, deletePurchaseReturn } = await import("./purchase-returns");
const { createInternalUse, updateInternalUse, deleteInternalUse, approveInternalUse } = await import("./internal-use");
const { getInternalUseCostSummary } = await import("../data/inventory");
const tables = [schema.products, schema.purchaseOrders, schema.purchaseReturns, schema.purchaseReturnItems,
  schema.stockLevels, schema.stockLots, schema.stockLotMovements, schema.stockMovements,
  schema.profiles, schema.shifts, schema.suppliers, schema.warehouses, schema.auditLogs, schema.notificationEvents,
  schema.cashTransactions, schema.internalUseIssues, schema.internalUseItems];
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
  await pg.exec("create unique index fixture_stock on stock_levels(store_id,product_id,warehouse_id)");

});

beforeEach(async () => {
  allowed = true; role = "owner";
  await pg.exec(`truncate ${tables.map(table => `"${getTableConfig(table).name}"`).join(",")}`);
  await database.insert(schema.profiles).values({ id: userId, storeId, fullName: "Owner", role: "owner" });
  await database.insert(schema.suppliers).values({ id: supplierId, storeId, code: "NCC", name: "Supplier", currentDebt: "30" });
  await database.insert(schema.warehouses).values({ id: warehouseId, storeId, name: "Warehouse" });
});
afterAll(async () => { await pg.close(); });
async function product() {
  const id = randomUUID();
  await database.insert(schema.products).values({ id, storeId, sku: id, name: "Product", baseUnit: "cái" });
  await database.insert(schema.stockLevels).values({ storeId, productId: id, warehouseId, quantity: "20" });
  return id;
}
const payload = (productId, quantity = 5, extra = {}) => ({ supplierId, warehouseId, discount: 0, vatRate: 0, refundAmount: 10, refundMethod: "cash", debtAmount: 40, items: [{ productId, quantity, unitCost: 10, returnUnitCost: 10 }], ...extra });
async function snapshot() {
  const stock = (await pg.query("select sum(quantity)::float as n from stock_levels")).rows[0].n;
  const debt = (await pg.query("select current_debt::float as n from suppliers where id=$1", [supplierId])).rows[0].n;
  const cash = (await pg.query("select coalesce(sum(case when type='in' then amount else -amount end),0)::float as n from cash_transactions")).rows[0].n;
  return { stock, debt, cash };
}
test("return edit/delete preserve identity and reverse actual clamped debt plus cash and stock", async () => {
  const p = await product();
  const created = await createPurchaseReturn(payload(p));
  expect(created.ok).toBe(true);
  expect(await snapshot()).toEqual({ stock: 15, debt: 0, cash: 10 });
  const updated = await updatePurchaseReturn(created.data.id, payload(p, 2, { debtAmount: 10 }));
  expect(updated).toEqual(created);
  expect(await snapshot()).toEqual({ stock: 18, debt: 20, cash: 10 });
  expect((await deletePurchaseReturn(created.data.id)).ok).toBe(true);
  expect(await snapshot()).toEqual({ stock: 20, debt: 30, cash: 0 });
  expect((await deletePurchaseReturn(created.data.id)).ok).toBe(false);
  expect(await snapshot()).toEqual({ stock: 20, debt: 30, cash: 0 });
});
test("failed edit rolls back its stock, cash and debt reversal", async () => {
  const p = await product();
  const created = await createPurchaseReturn(payload(p));
  expect((await updatePurchaseReturn(created.data.id, payload(p, 100))).ok).toBe(false);
  expect(await snapshot()).toEqual({ stock: 15, debt: 0, cash: 10 });
});
test("duplicate product lines cannot exceed stock", async () => {
  const p = await product();
  const body = payload(p, 12); body.items.push({ ...body.items[0] });
  expect((await createPurchaseReturn(body)).ok).toBe(false);
  expect(await snapshot()).toEqual({ stock: 20, debt: 30, cash: 0 });
});
test("foreign tenant and unauthorized mutations cannot change stock", async () => {
  const p = await product();
  expect((await createPurchaseReturn(payload(p, 1, { warehouseId: randomUUID() }))).ok).toBe(false);
  const created = await createPurchaseReturn(payload(p));
  allowed = false;
  expect((await deletePurchaseReturn(created.data.id)).ok).toBe(false);
  expect((await updatePurchaseReturn(created.data.id, payload(p, 1))).ok).toBe(false);
  expect(await snapshot()).toEqual({ stock: 15, debt: 0, cash: 10 });
});
test("internal use edit/delete reverses unit conversion exactly and keeps identity", async () => {
  const p = await product();
  const body = { warehouseId, reason: "other", items: [{ productId:p, productName:"Product",unitName:"box",unitMultiplier:2,quantity:3,unitCost:10 }] };
  const created = await createInternalUse(body);
  expect(created.ok).toBe(true);
  expect((await snapshot()).stock).toBe(14);
  body.items[0].quantity=1;
  const updated=await updateInternalUse(created.data.id,body);
  expect(updated.ok).toBe(true);
  expect((await snapshot()).stock).toBe(18);
  expect((await deleteInternalUse(created.data.id)).ok).toBe(true);
  expect((await snapshot()).stock).toBe(20);
  expect((await deleteInternalUse(created.data.id)).ok).toBe(false);
  expect((await snapshot()).stock).toBe(20);
});

test("tracked return edits and deletion restore all lots without double credit", async () => {
  const p = await product();
  await pg.query("update products set track_batches=true where id=$1", [p]);
  await database.insert(schema.stockLots).values({ storeId, productId:p,warehouseId,batchNumber:"LOT",receivedQuantity:"20",availableQuantity:"20",unitCost:"10" });
  const created = await createPurchaseReturn(payload(p));
  expect(created.ok).toBe(true);
  expect((await updatePurchaseReturn(created.data.id, payload(p,3))).ok).toBe(true);
  expect((await updatePurchaseReturn(created.data.id, payload(p,2))).ok).toBe(true);
  expect((await deletePurchaseReturn(created.data.id)).ok).toBe(true);
  expect((await pg.query("select available_quantity::float as n from stock_lots")).rows[0].n).toBe(20);
  expect(await snapshot()).toEqual({stock:20,debt:30,cash:0});
});

test("purchase return units convert stock and retain selected-unit money", async()=>{
 const p=await product();const body=payload(p,2,{refundAmount:0,debtAmount:0});
 body.items[0].unitMultiplier=4;body.items[0].unitName="Hộp";
 const created=await createPurchaseReturn(body);expect(created.ok).toBe(true);
 expect((await snapshot()).stock).toBe(12);
 body.items[0].quantity=1;
 expect((await updatePurchaseReturn(created.data.id,body)).ok).toBe(true);
 expect((await snapshot()).stock).toBe(16);
 expect((await pg.query("select total_refund::float as n from purchase_returns")).rows[0].n).toBe(10);
 expect((await deletePurchaseReturn(created.data.id)).ok).toBe(true);
 expect((await snapshot()).stock).toBe(20);
});

test("unchanged edit preserves historical deficit but cannot increase it",async()=>{
 const p=await product();const created=await createPurchaseReturn(payload(p));
 await pg.query("update stock_levels set quantity=-2 where product_id=$1",[p]);
 expect((await updatePurchaseReturn(created.data.id,payload(p))).ok).toBe(true);
 expect((await snapshot()).stock).toBe(-2);
 expect((await updatePurchaseReturn(created.data.id,payload(p,6))).ok).toBe(false);
 expect((await snapshot()).stock).toBe(-2);
 const reversed=(await pg.query("select unit_cost from stock_movements where ref_type='purchase_return_reversal'")).rows;
 expect(reversed.every(row=>row.unit_cost===null)).toBe(true);
});


test("internal-use draft create/edit/delete do not move stock; complete posts exactly once", async () => {
  const p = await product();
  const input = { warehouseId, intent: "draft", items: [{ productId: p, productName: "Product", unitName: "kg", unitMultiplier: 1, quantity: 0.5, unitCost: 10 }] };
  const before = await snapshot();
  const draft = await createInternalUse(input);
  expect(draft.ok).toBe(true);
  expect(draft.data.status).toBe("draft");
  expect((await getInternalUseCostSummary(storeId)).total).toBe(0);
  expect(await snapshot()).toEqual(before);
  expect((await pg.query("select count(*)::int as n from stock_movements")).rows[0].n).toBe(0);
  expect((await pg.query("select approved_at,approved_by from internal_use_issues where id=$1", [draft.data.id])).rows[0]).toEqual({ approved_at: null, approved_by: null });
  const edited = await updateInternalUse(draft.data.id, { ...input, items: [{ ...input.items[0], quantity: 1.5 }] });
  expect(edited.data.status).toBe("draft");
  expect(await snapshot()).toEqual(before);
  const complete = await updateInternalUse(draft.data.id, { ...input, intent: "complete", items: [{ ...input.items[0], quantity: 1.5 }] });
  expect(complete.data.status).toBe("approved");
  expect((await getInternalUseCostSummary(storeId)).total).toBe(15);
  expect((await snapshot()).stock).toBe(18.5);
  expect((await approveInternalUse(draft.data.id)).ok).toBe(false);
  expect((await snapshot()).stock).toBe(18.5);
  expect((await updateInternalUse(draft.data.id, input)).ok).toBe(false);
  expect((await snapshot()).stock).toBe(18.5);
  const second = await createInternalUse(input);
  const beforeDelete = await snapshot();
  expect((await deleteInternalUse(second.data.id)).ok).toBe(true);
  expect(await snapshot()).toEqual(beforeDelete);
});

test("explicit approval of a saved draft and legacy pending is guarded against double posting", async () => {
  const p = await product();
  for (const status of ["draft", "pending"]) {
    const saved = await createInternalUse({ warehouseId, intent: "draft", items: [{ productId: p, productName: "Product", unitName: "kg", unitMultiplier: 2, quantity: 0.5, unitCost: 10 }] });
    await pg.query("update internal_use_issues set status=$1 where id=$2", [status, saved.data.id]);
    const before = (await snapshot()).stock;
    expect((await approveInternalUse(saved.data.id)).ok).toBe(true);
    expect((await snapshot()).stock).toBe(before - 1);
    expect((await approveInternalUse(saved.data.id)).ok).toBe(false);
    expect((await snapshot()).stock).toBe(before - 1);
  }
});


test("warehouse may complete a draft but cannot bypass legacy pending approval", async () => {
  const p = await product();
  role = "warehouse";
  const input = { warehouseId, intent: "draft", items: [{ productId: p, productName: "Product", unitName: "kg", unitMultiplier: 1, quantity: 0.5, unitCost: 10 }] };
  const draft = await createInternalUse(input);
  expect(draft.ok).toBe(true);
  expect((await approveInternalUse(draft.data.id)).ok).toBe(true);
  const pending = await createInternalUse(input);
  await pg.query("update internal_use_issues set status='pending' where id=$1", [pending.data.id]);
  const before = await snapshot();
  expect(await approveInternalUse(pending.data.id)).toEqual({ ok: false, error: "errors.forbidden" });
  expect(await updateInternalUse(pending.data.id, { ...input, intent: "complete" })).toEqual({ ok: false, error: "errors.forbidden" });
  expect(await snapshot()).toEqual(before);
});
