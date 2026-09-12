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
const supplierId = randomUUID();
const warehouseId = randomUUID();

mock.module("@/lib/actions/common", () => ({ generateCode: () => "PCN-TEST" }));
mock.module("@/lib/cash", () => ({ fundForMethod: () => "cash", recordCashTx: async () => {} }));
mock.module("@/lib/notifications/events-core", () => ({ createDebtChangedEventInTx: async () => ({ created: false }) }));
mock.module("@/lib/audit/activity-log", () => ({ recordActivity: async () => {} }));

const { paySupplierPayable } = await import("./service-core");

const tables = [
  schema.suppliers,
  schema.warehouses,
  schema.purchaseOrders,
  schema.supplierPayableReceipts,
  schema.supplierPayableAllocations,
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
