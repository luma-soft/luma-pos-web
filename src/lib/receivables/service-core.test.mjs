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
const customerId = randomUUID();

mock.module("@/lib/actions/common", () => ({ generateCode: () => "PTN-TEST" }));
mock.module("@/lib/cash", () => ({ fundForMethod: () => "cash", recordCashTx: async () => {} }));
mock.module("@/lib/notifications/events-core", () => ({ createDebtChangedEventInTx: async () => ({ created: false }) }));
mock.module("@/lib/audit/activity-log", () => ({ recordActivity: async () => {} }));
mock.module("@/db", () => ({ db: database }));
mock.module("@/lib/data/payment-bank-accounts", () => ({ getEnabledPaymentBankAccounts: async () => [] }));

const { collectCustomerReceivable, createCustomerReceivableEntry } = await import("./service-core");
const { getCustomerReceivableOverview } = await import("../data/customer-receivables");

const tables = [
  schema.customers,
  schema.orders,
  schema.payments,
  schema.customerReceivableReceipts,
  schema.customerReceivableAllocations,
  schema.customerReceivableEntries,
  schema.returns,
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
  await database.insert(schema.customers).values({
    id: customerId,
    storeId,
    code: "KH-TEST",
    name: "Khách hàng test",
    currentDebt: "500000",
  });
});

afterAll(async () => { await pg.close(); });

test("a customer debt collection automatically updates the oldest unpaid invoice when allocation is omitted", async () => {
  const orderId = randomUUID();
  await database.insert(schema.orders).values({
    id: orderId,
    storeId,
    code: "HD-TEST",
    customerId,
    status: "completed",
    total: "500000",
    amountPaid: "0",
    createdAt: new Date("2026-09-01T00:00:00Z"),
  });

  const result = await collectCustomerReceivable(database, {
    customerId,
    amount: 500000,
    method: "cash",
    allocations: [],
    clientRequestId: "customer-payment-regression",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(true);
  expect((await pg.query("select amount_paid,payment_status from orders where id=$1", [orderId])).rows[0])
    .toEqual({ amount_paid: "500000.00", payment_status: "paid" });
  expect((await pg.query("select order_id,amount from customer_receivable_allocations")).rows)
    .toEqual([{ order_id: orderId, amount: "500000.00" }]);
});

test("a customer collection reconciles stale invoice balances to the customer debt before FIFO allocation", async () => {
  await database.update(schema.customers).set({ currentDebt: "545000" }).where(eq(schema.customers.id, customerId));
  const balances = [520_000, 20_000, 362_000, 140_000, 385_000, 545_000];
  const orderIds = balances.map(() => randomUUID());
  await database.insert(schema.orders).values(balances.map((balance, index) => ({
    id: orderIds[index],
    storeId,
    code: `HD-${index + 1}`,
    customerId,
    status: "completed",
    total: String(balance),
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));

  const result = await collectCustomerReceivable(database, {
    customerId,
    amount: 545000,
    method: "cash",
    allocations: [],
    clientRequestId: "customer-reconciled-payment",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(true);
  expect((await pg.query("select order_id,amount from customer_receivable_allocations order by order_id")).rows)
    .toEqual([{ order_id: orderIds[5], amount: "545000.00" }]);
  expect((await pg.query("select id,amount_paid from orders order by created_at")).rows)
    .toEqual(orderIds.map((id, index) => ({ id, amount_paid: index === 5 ? "545000.00" : "0.00" })));
});

test("the customer receivable overview shows only the reconciled invoice balance", async () => {
  await database.update(schema.customers).set({ currentDebt: "545000" }).where(eq(schema.customers.id, customerId));
  const balances = [520_000, 20_000, 362_000, 140_000, 385_000, 545_000];
  await database.insert(schema.orders).values(balances.map((balance, index) => ({
    id: randomUUID(),
    storeId,
    code: `HD-VIEW-${index + 1}`,
    customerId,
    status: "completed",
    total: String(balance),
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));

  const overview = await getCustomerReceivableOverview(storeId, customerId);

  expect(overview?.currentDebt).toBe(545000);
  expect(overview?.invoices.map((invoice) => ({ code: invoice.code, remaining: invoice.remaining })))
    .toEqual([{ code: "HD-VIEW-6", remaining: 545000 }]);
});

test("an unlinked customer adjustment is reconciled against the oldest open invoices", async () => {
  await database.update(schema.customers).set({ currentDebt: "200" }).where(eq(schema.customers.id, customerId));
  await database.insert(schema.orders).values([1, 2].map((index) => ({
    id: randomUUID(),
    storeId,
    code: `HD-GLOBAL-ADJ-${index}`,
    customerId,
    status: "completed",
    total: "100",
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index).padStart(2, "0")}T00:00:00Z`),
  })));
  const adjustment = await createCustomerReceivableEntry(database, {
    customerId,
    amount: -120,
    type: "adjustment_credit",
    reason: "Đối soát công nợ",
    clientRequestId: "customer-global-credit",
  }, { storeId, profileId: null, shiftId: null });
  expect(adjustment.ok).toBe(true);

  const overview = await getCustomerReceivableOverview(storeId, customerId);
  expect(overview?.currentDebt).toBe(80);
  expect(overview?.invoices.map((invoice) => ({ code: invoice.code, remaining: invoice.remaining })))
    .toEqual([{ code: "HD-GLOBAL-ADJ-2", remaining: 80 }]);
});

test("a linked customer debit remains payable even when the base invoice was already paid", async () => {
  await database.update(schema.customers).set({ currentDebt: "0" }).where(eq(schema.customers.id, customerId));
  const orderId = randomUUID();
  await database.insert(schema.orders).values({
    id: orderId,
    storeId,
    code: "HD-LINKED-DEBIT",
    customerId,
    status: "completed",
    total: "100",
    amountPaid: "100",
    paymentStatus: "paid",
  });
  const adjustment = await createCustomerReceivableEntry(database, {
    customerId,
    orderId,
    amount: 20,
    type: "adjustment_debit",
    reason: "Điều chỉnh tăng",
    clientRequestId: "customer-linked-debit",
  }, { storeId, profileId: null, shiftId: null });
  expect(adjustment.ok).toBe(true);

  const overview = await getCustomerReceivableOverview(storeId, customerId);
  expect(overview?.invoices.map((invoice) => ({ code: invoice.code, remaining: invoice.remaining })))
    .toEqual([{ code: "HD-LINKED-DEBIT", remaining: 20 }]);

  const collection = await collectCustomerReceivable(database, {
    customerId,
    amount: 20,
    method: "cash",
    allocations: [{ orderId, amount: 20 }],
    clientRequestId: "customer-linked-debit-collect",
  }, { storeId, profileId: null, shiftId: null });
  expect(collection.ok).toBe(true);
  expect((await pg.query("select amount_paid,payment_status from orders where id=$1", [orderId])).rows[0])
    .toEqual({ amount_paid: "120.00", payment_status: "paid" });
});

test("a customer settlement discount reduces only its linked invoice balance", async () => {
  await database.update(schema.customers).set({ currentDebt: "200" }).where(eq(schema.customers.id, customerId));
  const orderIds = [randomUUID(), randomUUID()];
  await database.insert(schema.orders).values(orderIds.map((id, index) => ({
    id,
    storeId,
    code: `HD-ADJ-${index + 1}`,
    customerId,
    status: "completed",
    total: "100",
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));
  const adjustment = await createCustomerReceivableEntry(database, {
    customerId,
    orderId: orderIds[1],
    amount: -20,
    type: "settlement_discount",
    reason: "Chiết khấu đã duyệt",
    clientRequestId: "customer-linked-discount",
  }, { storeId, profileId: null, shiftId: null });
  expect(adjustment.ok).toBe(true);

  const result = await collectCustomerReceivable(database, {
    customerId,
    amount: 100,
    method: "cash",
    allocations: [{ orderId: orderIds[1], amount: 90 }],
    clientRequestId: "customer-discount-balance-check",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(false);
  expect((await pg.query("select count(*)::int as count from customer_receivable_receipts")).rows[0])
    .toEqual({ count: 0 });
});

test("a debt-deduct return reduces the linked customer invoice before collection", async () => {
  await database.update(schema.customers).set({ currentDebt: "180" }).where(eq(schema.customers.id, customerId));
  const orderIds = [randomUUID(), randomUUID()];
  await database.insert(schema.orders).values(orderIds.map((id, index) => ({
    id,
    storeId,
    code: `HD-RET-${index + 1}`,
    customerId,
    status: "completed",
    total: "100",
    amountPaid: "0",
    createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  })));
  await database.insert(schema.returns).values({
    id: randomUUID(),
    storeId,
    code: "TH-TEST",
    orderId: orderIds[1],
    customerId,
    refundMethod: "debt_deduct",
    totalRefund: "20",
    status: "completed",
  });

  const result = await collectCustomerReceivable(database, {
    customerId,
    amount: 100,
    method: "cash",
    allocations: [{ orderId: orderIds[1], amount: 90 }],
    clientRequestId: "customer-return-balance-check",
  }, { storeId, profileId: null, shiftId: null });

  expect(result.ok).toBe(false);
  expect((await pg.query("select count(*)::int as count from customer_receivable_receipts")).rows[0])
    .toEqual({ count: 0 });
});
