import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema";

const pg = new PGlite();
const database = drizzle(pg, { schema });
mock.module("@/db", () => ({ db: database }));
const { normalizeOrderItems } = await import("./normalize");
const { readOrderLinePricing } = await import("./line-pricing-snapshot");
const dialect = new PgDialect();
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const storeId = randomUUID(), otherStoreId = randomUUID();
const productId = randomUUID(), missingGrossId = randomUUID(), zeroId = randomUUID();
const retailId = randomUUID(), costId = randomUUID(), grossId = randomUUID(), customId = randomUUID(), foreignId = randomUUID();
const companyId = randomUUID(), companyProductId = randomUUID(), receiptId = randomUUID();
const line = (overrides = {}) => ({ productId, unitName: "cái", quantity: 2, ...overrides });

beforeAll(async () => {
  // Real normalization queries run against the selected real schema columns.
  // This fixture needs no unrelated FKs, RLS or application infrastructure.
  const enums = new Set();
  for (const table of [schema.products, schema.productUnits, schema.productPrices,
    schema.priceBooks, schema.promotions, schema.productComboItems, schema.purchaseOrders, schema.purchaseOrderItems, schema.orderItems]) {
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
  await database.insert(schema.priceBooks).values([
    { id: retailId, storeId, name: "Giá Chung", systemType: "retail", isDefault: true },
    { id: costId, storeId, name: "Giá vốn", systemType: "cost", costBased: true, managerOnly: true },
    { id: grossId, storeId, name: "Giá Chưa Chiết Khấu", systemType: "purchase", managerOnly: true },
    { id: customId, storeId, name: "Giá thợ" },
    { id: foreignId, storeId: otherStoreId, name: "Giá vốn", systemType: "cost", costBased: true, managerOnly: true },
    { id: companyId, storeId, name: "Giá chưa chiết khấu", systemType: "list" },
  ]);
  await database.insert(schema.products).values([
    { id: productId, storeId, sku: "KNOWN", name: "Sản phẩm", baseUnit: "cái", costPrice: "90", lastPurchasePrice: "150", retailPrice: "200" },
    { id: missingGrossId, storeId, sku: "MISSING", name: "Thiếu giá nhập", baseUnit: "cái", costPrice: "90", lastPurchasePrice: null, retailPrice: "200" },
    { id: zeroId, storeId, sku: "FREE", name: "Hàng miễn phí", baseUnit: "cái", costPrice: "0", lastPurchasePrice: "0", retailPrice: "200" },
    { id: companyProductId, storeId, sku: "TIEN-PHONG", name: "Ống Tiền Phong", baseUnit: "cây", costPrice: "65000", retailPrice: "200000" },
  ]);
  await database.insert(schema.purchaseOrders).values({ id: receiptId, storeId, code: "PN001", supplierId: randomUUID(), warehouseId: randomUUID(), status: "received", discount: "24" });
  await database.insert(schema.purchaseOrderItems).values([
    { storeId, purchaseOrderId: receiptId, productId, quantity: "2", unitCost: "150", discount: "36", total: "264" },
    { storeId, purchaseOrderId: receiptId, productId: zeroId, quantity: "1", unitCost: "0", total: "0" },
  ]);
  await database.insert(schema.productUnits).values({ storeId, productId, unitName: "hộp", multiplier: "10", priceOverride: "1800" });
  await database.insert(schema.productUnits).values({ storeId, productId: companyProductId, unitName: "bó", multiplier: "10", priceOverride: "1800000" });
  await database.insert(schema.promotions).values({ storeId, productId: companyProductId, name: "Khuyến mại bán lẻ", tiers: [{ minQty: 1, discountPct: 50 }], isActive: true });
  // A stale imported override must never replace any automatic price source.
  await database.insert(schema.productPrices).values([
    { storeId, productId, priceBookId: retailId, price: "777" },
    { storeId, productId, priceBookId: costId, price: "888" },
    { storeId, productId, priceBookId: grossId, price: "999" },
    { storeId, productId: missingGrossId, priceBookId: grossId, price: "999" },
    { storeId, productId, priceBookId: customId, price: "160" },
    { storeId, productId: companyProductId, priceBookId: companyId, price: "100000" },
  ]);
});
afterAll(async () => { await pg.close(); });

for (const role of ["owner", "manager"]) {
  test(`${role} resolves all automatic sources and ignores stale overrides`, async () => {
    const items = await normalizeOrderItems(storeId, [line({ priceBookId: retailId }), line({ priceBookId: costId }), line({ priceBookId: grossId })], null, role);
    expect(items.map((item) => item.unitPrice)).toEqual([200, 90, 120]);
    expect(items.map((item) => item.total)).toEqual([400, 180, 240]);
  });

  test(`${role} uses base-unit multiplication for cost and gross instead of the retail unit override`, async () => {
    const items = await normalizeOrderItems(storeId, [line({ unitName: "hộp", priceBookId: costId }), line({ unitName: "hộp", priceBookId: grossId }), line({ unitName: "hộp", priceBookId: retailId })], null, role);
    expect(items.map((item) => item.unitPrice)).toEqual([900, 1200, 1800]);
    expect(items.map((item) => item.unitMultiplier)).toEqual([10, 10, 10]);
    expect(items[0].stockItems).toEqual([{ productId, quantity: 20 }]);
  });
}

for (const manualUnitPrice of [undefined, 0, 150]) {
  test(`unknown gross rejects even when manual price is ${manualUnitPrice}`, async () => {
    await expect(normalizeOrderItems(storeId, [line({ productId: missingGrossId, priceBookId: grossId, manualUnitPrice })], null, "owner"))
      .rejects.toThrow("PRICE_BOOK_PRICE_UNAVAILABLE");
  });
}

test("genuine zero gross and zero cost remain usable", async () => {
  const items = await normalizeOrderItems(storeId, [line({ productId: zeroId, priceBookId: grossId }), line({ productId: zeroId, priceBookId: costId })], null, "owner");
  expect(items.map((item) => item.unitPrice)).toEqual([0, 0]);
  expect(items.map((item) => item.total)).toEqual([0, 0]);
});

for (const role of ["cashier", "staff", undefined]) {
  test(`${role ?? "missing role"} cannot select either internal source directly or through the invoice`, async () => {
    for (const priceBookId of [costId, grossId]) {
      await expect(normalizeOrderItems(storeId, [line({ priceBookId, manualUnitPrice: 1 })], null, role)).rejects.toThrow("PRICE_BOOK_FORBIDDEN");
      await expect(normalizeOrderItems(storeId, [line()], priceBookId, role)).rejects.toThrow("PRICE_BOOK_FORBIDDEN");
    }
    const publicItems = await normalizeOrderItems(storeId, [line({ priceBookId: retailId }), line({ priceBookId: customId })], null, role);
    expect(publicItems.map((item) => item.unitPrice)).toEqual([200, 160]);
  });
}

test("manual prices and line discounts remain invoice-only changes for an authorized user", async () => {
  const items = await normalizeOrderItems(storeId, [line({ priceBookId: costId, manualUnitPrice: 85, lineDiscount: 5 })], null, "manager");
  expect(items[0].preDiscountUnitPrice).toBe(85);
  expect(items[0].unitPrice).toBe(80);
  expect(items[0].total).toBe(160);
  const result = await pg.query("select cost_price, last_purchase_price, retail_price from products where id = $1", [productId]);
  expect(result.rows[0]).toEqual({ cost_price: "90.00", last_purchase_price: "150.00", retail_price: "200.00" });
});

test("custom unit pricing retains its existing retail-override ratio", async () => {
  const [item] = await normalizeOrderItems(storeId, [line({ unitName: "hộp", priceBookId: customId })], null, "cashier");
  expect(item.unitPrice).toBe(1440); // 1,800 × (160 / 200)
});

test("a price-book ID from another store is rejected", async () => {
  await expect(normalizeOrderItems(storeId, [line({ priceBookId: foreignId })], null, "owner")).rejects.toThrow("PRICE_BOOK_NOT_FOUND");
});

test("custom manager-only books enforce permissions during transactional normalization", async () => {
  await pg.query("update price_books set manager_only=true where id=$1", [customId]);
  try {
    await expect(database.transaction((tx) => normalizeOrderItems(storeId, [line({ priceBookId: customId })], null, "cashier", tx)))
      .rejects.toThrow("PRICE_BOOK_FORBIDDEN");
    const [item] = await database.transaction((tx) => normalizeOrderItems(storeId, [line({ priceBookId: customId })], null, "manager", tx));
    expect(item.unitPrice).toBe(160);
  } finally { await pg.query("update price_books set manager_only=false where id=$1", [customId]); }
});

test("cashier applies entered company discount without stacking the retail promotion", async () => {
  const items = await normalizeOrderItems(storeId, [
    line({ productId: companyProductId, unitName: "cây", quantity: 3, priceBookId: companyId, lineDiscount: 999, lineDiscountMode: "pct", lineDiscountValue: 20 }),
    line({ productId: companyProductId, unitName: "cây", priceBookId: companyId }),
    line({ productId: companyProductId, unitName: "cây", priceBookId: retailId }),
  ], null, "cashier");
  expect(items.map((item) => item.unitPrice)).toEqual([80000, 100000, 100000]);
  expect(items[0]).toMatchObject({ preDiscountUnitPrice: 100000, lineDiscount: 20000, lineDiscountMode: "pct", lineDiscountValue: 20, total: 240000, priceBookName: "Giá chưa chiết khấu" });
});

test("company alternate units multiply the company base price without retail unit overrides", async () => {
  const [item] = await normalizeOrderItems(storeId, [line({ productId: companyProductId, unitName: "bó", priceBookId: companyId, lineDiscountMode: "pct", lineDiscountValue: 20 })], null, "cashier");
  expect(item.preDiscountUnitPrice).toBe(1000000);
  expect(item.unitPrice).toBe(800000);
});

test("missing company price rejects instead of falling back to retail", async () => {
  await expect(normalizeOrderItems(storeId, [line({ priceBookId: companyId })], null, "cashier")).rejects.toThrow("PRICE_BOOK_PRICE_UNAVAILABLE");
});

test("persisted percent and price snapshots remain stable when the company book changes", async () => {
  const [item] = await normalizeOrderItems(storeId, [line({ productId: companyProductId, unitName: "cây", quantity: 3, priceBookId: companyId, lineDiscountMode: "pct", lineDiscountValue: 20 })], null, "cashier");
  const [saved] = await database.insert(schema.orderItems).values({
    storeId, orderId: randomUUID(), productId: item.productId, productName: item.productName,
    unitName: item.unitName, unitMultiplier: String(item.unitMultiplier), quantity: String(item.quantity), unitPrice: String(item.unitPrice), total: String(item.total),
    preDiscountUnitPrice: String(item.preDiscountUnitPrice), discount: String(item.lineDiscount * item.quantity),
    lineDiscountMode: item.lineDiscountMode, lineDiscountValue: String(item.lineDiscountValue), priceBookId: item.priceBookId, priceBookName: item.priceBookName,
  }).returning();
  await pg.query("update price_books set name = 'Bảng giá công ty mới' where id = $1", [companyId]);
  await pg.query("update product_prices set price = 120000 where price_book_id = $1", [companyId]);
  const [reloaded] = await database.select().from(schema.orderItems);
  expect(reloaded.id).toBe(saved.id);
  expect(reloaded.priceBookName).toBe("Giá chưa chiết khấu");
  expect(reloaded.discount).toBe("60000.00");
  expect(readOrderLinePricing(reloaded)).toMatchObject({ unitPrice: 100000, netUnitPrice: 80000, discount: 60000, lineDiscountMode: "pct", lineDiscountValue: 20 });
});
