import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID();
const supplierId = randomUUID();
const warehouseId = randomUUID();

mock.module("@/lib/actions/common", () => ({ generateCode: () => "PCN-TEST" }));
mock.module("@/lib/cash", () => ({ fundForMethod: () => "cash", recordCashTx: async () => {} }));
mock.module("@/lib/notifications/events-core", () => ({ createDebtChangedEventInTx: async () => ({ created: false }) }));
mock.module("@/lib/audit/activity-log", () => ({ recordActivity: async () => {} }));
mock.module("@/db", () => ({ db: database }));

const { createSupplierPayableEntry, paySupplierPayable } = await import("./service-core");
const { getSupplierPayableOverview } = await import("../data/supplier-payables");

const tables = [
  schema.suppliers,
  schema.warehouses,
  schema.purchaseOrders,
  schema.supplierPayableReceipts,
  schema.supplierPayableAllocations,
  schema.supplierPayableEntries,
  schema.purchaseReturns,
  schema.paymentBankAccounts,
];
const dialect = new PgDialect();
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

beforeAll(async () => {
  const enums = new Set();
  for (const table of tables) {
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (column.enumValues?.length && !enums.has(column.getSQLType())) {
        await pg.exec(`create type ${column.getSQLType()} as enum (${column.enumValues.map(quote).join(",")})`);
        enums.add(column.getSQLType());
      }
    }
    const definitions = config.columns.map((column) => {
      const value = column.default;
      const defaultSql = value === undefined ? "" : ` default ${value instanceof SQL
        ? dialect.sqlToQuery(value).sql
        : typeof value === "boolean" || typeof value === "number"
          ? String(value)
          : quote(typeof value === "string" ? value : JSON.stringify(value))}`;
      return `"${column.name}" ${column.getSQLType()}${column.notNull ? " not null" : ""}${defaultSql}${column.primary ? " primary key" : ""}`;
    });
    for (const key of config.primaryKeys) {
      definitions.push(`primary key (${key.columns.map((column) => `"${column.name}"`).join(",")})`);
    }
    await pg.exec(`create table "${config.name}" (${definitions.join(",")})`);
  }
});

beforeEach(async () => {
  await pg.exec(`truncate ${tables.map((table) => `"${getTableConfig(table).name}"`).reverse().join(",")}`);
  await database.insert(schema.suppliers).values({
    id: supplierId,
    storeId,
    code: "NCC-TEST",
    name: "Nhà cung cấp test",
    currentDebt: "1827000",
  });
  await database.insert(schema.warehouses).values({ id: warehouseId, storeId, name: "Kho test" });
});

afterAll(async () => { await pg.close(); });

test("a supplier payment automatically updates an unpaid purchase when allocation is omitted", async () => {
  const purchaseOrderId = randomUUID();
  await database.insert(schema.purchaseOrders).values({
    id: purchaseOrderId,
    storeId,
    code: "PN-260911-183201WY",
    supplierId,
    warehouseId,
    status: "received",
    total: "1827000",
    amountPaid: "0",
    createdAt: new Date("2026-09-11T18:32:01Z"),
  });

  const result = await paySupplierPayable(database, {
    supplierId,
    amount: 1827000,
    method: "cash",
    allocations: [],
    clientRequestId: "supplier-payment-regression",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(true);
  expect((await pg.query("select amount_paid from purchase_orders where id=$1", [purchaseOrderId])).rows[0])
    .toEqual({ amount_paid: "1827000.00" });
  expect((await pg.query("select purchase_order_id,amount from supplier_payable_allocations")).rows)
    .toEqual([{ purchase_order_id: purchaseOrderId, amount: "1827000.00" }]);
});

test("a supplier payment rejects a purchase already offset by the supplier debt balance", async () => {
  await database.update(schema.suppliers).set({ currentDebt: "545000" }).where(eq(schema.suppliers.id, supplierId));
  const balances = [520_000, 20_000, 362_000, 140_000, 385_000, 545_000];
  const purchaseOrderIds = balances.map(() => randomUUID());
  await database.insert(schema.purchaseOrders).values(balances.map((balance, index) => ({
    id: purchaseOrderIds[index],
    storeId,
    code: `PN-${index + 1}`,
    supplierId,
    warehouseId,
    status: "received",
    total: String(balance),
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));

  const result = await paySupplierPayable(database, {
    supplierId,
    amount: 545000,
    method: "cash",
    allocations: [{ purchaseOrderId: purchaseOrderIds[0], amount: 520000 }],
    clientRequestId: "supplier-reconciled-payment",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(false);
  expect((await pg.query("select count(*)::int as count from supplier_payable_allocations")).rows[0])
    .toEqual({ count: 0 });
  expect((await pg.query("select amount_paid from purchase_orders where id=$1", [purchaseOrderIds[0]])).rows[0])
    .toEqual({ amount_paid: "0.00" });
});

test("a supplier payment automatically allocates only against the reconciled newest purchase", async () => {
  await database.update(schema.suppliers).set({ currentDebt: "545000" }).where(eq(schema.suppliers.id, supplierId));
  const balances = [520_000, 20_000, 362_000, 140_000, 385_000, 545_000];
  const purchaseOrderIds = balances.map(() => randomUUID());
  await database.insert(schema.purchaseOrders).values(balances.map((balance, index) => ({
    id: purchaseOrderIds[index],
    storeId,
    code: `PN-AUTO-${index + 1}`,
    supplierId,
    warehouseId,
    status: "received",
    total: String(balance),
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));

  const result = await paySupplierPayable(database, {
    supplierId,
    amount: 545000,
    method: "cash",
    allocations: [],
    clientRequestId: "supplier-reconciled-auto-payment",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(true);
  expect((await pg.query("select purchase_order_id,amount from supplier_payable_allocations")).rows)
    .toEqual([{ purchase_order_id: purchaseOrderIds[5], amount: "545000.00" }]);
});

test("the supplier payable overview shows only the reconciled purchase balance", async () => {
  await database.update(schema.suppliers).set({ currentDebt: "545000" }).where(eq(schema.suppliers.id, supplierId));
  const balances = [520_000, 20_000, 362_000, 140_000, 385_000, 545_000];
  await database.insert(schema.purchaseOrders).values(balances.map((balance, index) => ({
    id: randomUUID(),
    storeId,
    code: `PN-VIEW-${index + 1}`,
    supplierId,
    warehouseId,
    status: "received",
    total: String(balance),
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));

  const overview = await getSupplierPayableOverview(storeId, supplierId, database);

  expect(overview?.currentDebt).toBe(545000);
  expect(overview?.invoices.map((invoice) => ({ code: invoice.code, remaining: invoice.remaining })))
    .toEqual([{ code: "PN-VIEW-6", remaining: 545000 }]);
});

test("an unlinked supplier adjustment is reconciled against the oldest open purchases", async () => {
  await database.update(schema.suppliers).set({ currentDebt: "200" }).where(eq(schema.suppliers.id, supplierId));
  await database.insert(schema.purchaseOrders).values([1, 2].map((index) => ({
    id: randomUUID(),
    storeId,
    code: `PN-GLOBAL-ADJ-${index}`,
    supplierId,
    warehouseId,
    status: "received",
    total: "100",
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index).padStart(2, "0")}T00:00:00Z`),
  })));
  const adjustment = await createSupplierPayableEntry(database, {
    supplierId,
    amount: -120,
    reason: "Đối soát công nợ",
    clientRequestId: "supplier-global-credit",
  }, { storeId, profileId: null, shiftId: null });
  expect(adjustment.ok).toBe(true);

  const overview = await getSupplierPayableOverview(storeId, supplierId, database);
  expect(overview?.currentDebt).toBe(80);
  expect(overview?.invoices.map((invoice) => ({ code: invoice.code, remaining: invoice.remaining })))
    .toEqual([{ code: "PN-GLOBAL-ADJ-2", remaining: 80 }]);
});

test("a linked supplier debit remains payable even when the base purchase was already paid", async () => {
  await database.update(schema.suppliers).set({ currentDebt: "0" }).where(eq(schema.suppliers.id, supplierId));
  const purchaseOrderId = randomUUID();
  await database.insert(schema.purchaseOrders).values({
    id: purchaseOrderId,
    storeId,
    code: "PN-LINKED-DEBIT",
    supplierId,
    warehouseId,
    status: "received",
    total: "100",
    amountPaid: "100",
  });
  const adjustment = await createSupplierPayableEntry(database, {
    supplierId,
    purchaseOrderId,
    amount: 20,
    reason: "Điều chỉnh tăng",
    clientRequestId: "supplier-linked-debit",
  }, { storeId, profileId: null, shiftId: null });
  expect(adjustment.ok).toBe(true);

  const overview = await getSupplierPayableOverview(storeId, supplierId, database);
  expect(overview?.invoices.map((invoice) => ({ code: invoice.code, remaining: invoice.remaining })))
    .toEqual([{ code: "PN-LINKED-DEBIT", remaining: 20 }]);

  const payment = await paySupplierPayable(database, {
    supplierId,
    amount: 20,
    method: "cash",
    allocations: [{ purchaseOrderId, amount: 20 }],
    clientRequestId: "supplier-linked-debit-pay",
  }, { storeId, profileId: null, shiftId: null });
  expect(payment.ok).toBe(true);
  expect((await pg.query("select amount_paid from purchase_orders where id=$1", [purchaseOrderId])).rows[0])
    .toEqual({ amount_paid: "120.00" });
});

test("a supplier adjustment credit reduces only its linked purchase balance", async () => {
  await database.update(schema.suppliers).set({ currentDebt: "200" }).where(eq(schema.suppliers.id, supplierId));
  const purchaseOrderIds = [randomUUID(), randomUUID()];
  await database.insert(schema.purchaseOrders).values(purchaseOrderIds.map((id, index) => ({
    id,
    storeId,
    code: `PN-ADJ-${index + 1}`,
    supplierId,
    warehouseId,
    status: "received",
    total: "100",
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));
  const adjustment = await createSupplierPayableEntry(database, {
    supplierId,
    purchaseOrderId: purchaseOrderIds[1],
    amount: -20,
    reason: "Chiết khấu đã duyệt",
    clientRequestId: "supplier-linked-credit",
  }, { storeId, profileId: null, shiftId: null });
  expect(adjustment.ok).toBe(true);

  const result = await paySupplierPayable(database, {
    supplierId,
    amount: 100,
    method: "cash",
    allocations: [{ purchaseOrderId: purchaseOrderIds[1], amount: 90 }],
    clientRequestId: "supplier-adjustment-balance-check",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(false);
  expect((await pg.query("select count(*)::int as count from supplier_payable_receipts")).rows[0])
    .toEqual({ count: 0 });
});

test("a linked supplier return reduces the purchase balance before payment allocation", async () => {
  await database.update(schema.suppliers).set({ currentDebt: "180" }).where(eq(schema.suppliers.id, supplierId));
  const purchaseOrderIds = [randomUUID(), randomUUID()];
  await database.insert(schema.purchaseOrders).values(purchaseOrderIds.map((id, index) => ({
    id,
    storeId,
    code: `PN-RET-${index + 1}`,
    supplierId,
    warehouseId,
    status: "received",
    total: "100",
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));
  await database.insert(schema.purchaseReturns).values({
    id: randomUUID(),
    storeId,
    code: "TRN-TEST",
    supplierId,
    warehouseId,
    purchaseOrderId: purchaseOrderIds[1],
    status: "completed",
    debtAmount: "20",
  });

  const result = await paySupplierPayable(database, {
    supplierId,
    amount: 100,
    method: "cash",
    allocations: [{ purchaseOrderId: purchaseOrderIds[1], amount: 90 }],
    clientRequestId: "supplier-return-balance-check",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(false);
  expect((await pg.query("select count(*)::int as count from supplier_payable_receipts")).rows[0])
    .toEqual({ count: 0 });
});

test("an unlinked historical supplier return is reconciled against open purchases", async () => {
  await database.update(schema.suppliers).set({ currentDebt: "180" }).where(eq(schema.suppliers.id, supplierId));
  await database.insert(schema.purchaseOrders).values([1, 2].map((index) => ({
    id: randomUUID(),
    storeId,
    code: `PN-UNLINKED-RET-${index}`,
    supplierId,
    warehouseId,
    status: "received",
    total: "100",
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index).padStart(2, "0")}T00:00:00Z`),
  })));
  await database.insert(schema.purchaseReturns).values({
    id: randomUUID(),
    storeId,
    code: "TRN-UNLINKED",
    supplierId,
    warehouseId,
    status: "completed",
    debtAmount: "20",
  });

  const overview = await getSupplierPayableOverview(storeId, supplierId, database);
  expect(overview?.currentDebt).toBe(180);
  expect(overview?.invoices.map((invoice) => ({ code: invoice.code, remaining: invoice.remaining })))
    .toEqual([
      { code: "PN-UNLINKED-RET-2", remaining: 100 },
      { code: "PN-UNLINKED-RET-1", remaining: 80 },
    ]);
});
