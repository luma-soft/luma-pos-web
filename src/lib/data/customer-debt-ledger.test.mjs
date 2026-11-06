import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID();
const customerId = randomUUID();

mock.module("@/db", () => ({ db: database }));
mock.module("@/lib/data/supplier-payables", () => ({ getSupplierPayableOverview: async () => null }));

const { getCustomers } = await import("./partners");

const tables = [
  schema.customers,
  schema.customerConsents,
  schema.orders,
  schema.returns,
  schema.returnItems,
  schema.orderItems,
  schema.payments,
  schema.customerReceivableAllocations,
  schema.customerReceivableReceipts,
  schema.customerReceivableEntries,
  schema.profiles,
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
    code: "KH-LEDGER",
    name: "Khách hàng sổ nợ",
    currentDebt: "60",
  });
});

afterAll(async () => { await pg.close(); });

test("cancelled invoices and their payments stay out of the debt ledger while cancelled receipts net to zero", async () => {
  const completedOrderId = randomUUID();
  const cancelledOrderId = randomUUID();
  const cancelledReceiptId = randomUUID();
  await database.insert(schema.orders).values([
    {
      id: completedOrderId,
      storeId,
      code: "HD-ACTIVE",
      customerId,
      status: "completed",
      total: "100",
      amountPaid: "40",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    },
    {
      id: cancelledOrderId,
      storeId,
      code: "HD-CANCELLED",
      customerId,
      status: "cancelled",
      total: "80",
      amountPaid: "30",
      createdAt: new Date("2026-10-02T00:00:00Z"),
    },
  ]);
  await database.insert(schema.payments).values([
    {
      id: randomUUID(),
      storeId,
      orderId: completedOrderId,
      amount: "40",
      method: "cash",
      status: "manual_confirmed",
    },
    {
      id: randomUUID(),
      storeId,
      orderId: cancelledOrderId,
      amount: "30",
      method: "cash",
      status: "manual_confirmed",
    },
  ]);
  await database.insert(schema.customerReceivableReceipts).values({
    id: cancelledReceiptId,
    storeId,
    customerId,
    code: "PT-CANCELLED",
    status: "cancelled",
    amount: "25",
    method: "cash",
    clientRequestId: "cancelled-receipt-ledger-test",
    createdAt: new Date("2026-10-03T00:00:00Z"),
    cancelledAt: new Date("2026-10-04T00:00:00Z"),
    cancellationReason: "Ghi nhận nhầm",
  });

  const result = await getCustomers(
    storeId,
    { customerId, page: 1, pageSize: 1 },
    { includeHistory: true, includeInactive: true },
  );
  const customer = result.rows[0];
  const ledger = customer.debtLedger;

  expect(customer.salesHistory.some((row) => row.id === cancelledOrderId)).toBe(true);
  expect(ledger.some((row) => row.id === cancelledOrderId)).toBe(false);
  expect(ledger.some((row) => row.orderId === cancelledOrderId)).toBe(false);
  expect(ledger.some((row) => row.orderId === completedOrderId && row.kind === "payment")).toBe(true);
  expect(ledger.some((row) => row.id === cancelledReceiptId)).toBe(true);
  expect(ledger.some((row) => row.id === `${cancelledReceiptId}:cancellation`)).toBe(true);
  expect(ledger
    .filter((row) => row.receiptId === cancelledReceiptId)
    .reduce((sum, row) => sum + row.value, 0)).toBe(0);
});
