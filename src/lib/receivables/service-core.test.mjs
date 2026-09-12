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

mock.module("@/lib/actions/common", () => ({ generateCode: () => "PTN-TEST" }));
mock.module("@/lib/cash", () => ({ fundForMethod: () => "cash", recordCashTx: async () => {} }));
mock.module("@/lib/notifications/events-core", () => ({ createDebtChangedEventInTx: async () => ({ created: false }) }));
mock.module("@/lib/audit/activity-log", () => ({ recordActivity: async () => {} }));

const { collectCustomerReceivable } = await import("./service-core");

const tables = [
  schema.customers,
  schema.orders,
  schema.payments,
  schema.customerReceivableReceipts,
  schema.customerReceivableAllocations,
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
