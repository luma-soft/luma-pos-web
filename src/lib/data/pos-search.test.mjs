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
mock.module("@/lib/db/schema-compat", () => ({ hasProductComplianceColumns: async () => true }));
mock.module("@/lib/media/config", () => ({
  getPublicMediaConfig: () => ({ publicBucket: "test-public", publicBaseUrl: "https://media.example.test" }),
}));
const { searchPosProductRows } = await import("./pos");

const storeId = randomUUID(), otherStoreId = randomUUID();
const parentId = randomUUID(), productId = randomUUID(), siblingId = randomUUID(), zeroCostId = randomUUID();
const purchaseBookId = randomUUID(), listBookId = randomUUID(), retailBookId = randomUUID();
const costBookId = randomUUID(), tradeBookId = randomUUID(), otherCostBookId = randomUUID();
let accessRole = "owner";
const salesGate = async () => ({ ok: true, storeId, role: accessRole });
mock.module("@/lib/actions/common", () => ({ requireSalesAccess: salesGate }));
mock.module("@/lib/mobile/auth", () => ({ requireMobileSalesAccess: salesGate }));
const { searchPosProducts } = await import("../actions/pos-search");
const { GET } = await import("../../app/api/mobile/pos/search/route");
const dialect = new PgDialect();
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

beforeAll(async () => {
  // Execute the real POS and price-book queries against isolated Postgres tables.
  // Foreign keys and indexes outside the read path are not needed for this fixture.
  const enums = new Set();
  for (const table of [schema.products, schema.categories, schema.warehouses,
    schema.orders, schema.orderItems, schema.stockLevels, schema.productUnits,
    schema.productComboItems, schema.priceBooks, schema.productPrices,
    schema.productMedia, schema.mediaObjects]) {
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (!column.enumValues?.length || enums.has(column.getSQLType())) continue;
      await pg.exec(`create type ${column.getSQLType()} as enum (${column.enumValues.map(quote).join(",")})`);
      enums.add(column.getSQLType());
    }
    const definitions = config.columns.map((column) => {
      const value = column.default;
      const defaultSql = value === undefined ? "" : " default " + (value instanceof SQL
        ? dialect.sqlToQuery(value).sql
        : typeof value === "boolean" || typeof value === "number" ? String(value)
          : quote(typeof value === "string" ? value : JSON.stringify(value)));
      return `"${column.name}" ${column.getSQLType()}${column.notNull ? " not null" : ""}${defaultSql}${column.primary ? " primary key" : ""}`;
    });
    await pg.exec(`create table "${config.name}" (${definitions.join(",")})`);
  }
  await pg.exec(`
    create table purchase_orders (id uuid primary key, store_id uuid not null, status text not null,
      discount numeric not null default 0, cost_effective_at timestamptz, created_at timestamptz not null default now());
    create table purchase_order_items (id uuid primary key default gen_random_uuid(), store_id uuid not null,
      purchase_order_id uuid not null, product_id uuid not null, quantity numeric not null,
      unit_multiplier numeric not null default 1, total numeric not null);
  `);
  await database.insert(schema.warehouses).values({ storeId, name: "Main", isDefault: true });
  await database.insert(schema.priceBooks).values([
    { id: retailBookId, storeId, name: "Giá chung", systemType: "retail", isDefault: true },
    { id: purchaseBookId, storeId, name: "Giá nhập cuối", systemType: "purchase", managerOnly: true },
    { id: listBookId, storeId, name: "Giá chưa chiết khấu", systemType: "list" },
    { id: costBookId, storeId, name: "Giá vốn", costBased: true, managerOnly: true },
    { id: tradeBookId, storeId, name: "Giá thợ" },
    { id: otherCostBookId, storeId: otherStoreId, name: "Giá vốn", costBased: true, managerOnly: true },
  ]);
  await database.insert(schema.products).values([
    { id: parentId, storeId, sku: "RAP2200", name: "RAP2200", isVariantParent: true },
    { id: productId, storeId, sku: "RAP2200-E", name: "RAP2200 E", parentProductId: parentId, costPrice: "1280000", lastPurchasePrice: "1400000", retailPrice: "1490000" },
    { id: siblingId, storeId, sku: "RAP2200-F", name: "RAP2200 F", parentProductId: parentId, costPrice: "990000", lastPurchasePrice: "1100000", retailPrice: "1190000" },
    { id: zeroCostId, storeId, sku: "ZERO-COST", name: "Zero cost", costPrice: "0", lastPurchasePrice: "0", retailPrice: "100000" },
    { storeId: otherStoreId, sku: "RAP2200-OTHER", name: "RAP2200 other store", costPrice: "900000", retailPrice: "1200000" },
  ]);
  await database.insert(schema.productPrices).values([
    { storeId, productId, priceBookId: tradeBookId, price: "1400000" },
    { storeId, productId, priceBookId: listBookId, price: "1800000" },
    { storeId, productId: zeroCostId, priceBookId: listBookId, price: "0" },
  ]);
  const receiptId = randomUUID();
  await pg.query("insert into purchase_orders (id, store_id, status, discount) values ($1, $2, 'received', 140000)", [receiptId, storeId]);
  // Two E units total 2,660,000 after line discounts, less invoice discount
  // 140,000. Net 1,260,000 differs from historical gross 1,400,000.
  await pg.query("insert into purchase_order_items (store_id, purchase_order_id, product_id, quantity, total) values ($1,$2,$3,2,2660000), ($1,$2,$4,1,0)",
    [storeId, receiptId, productId, zeroCostId]);
});
afterAll(async () => { await pg.close(); });

for (const role of ["owner", "manager"]) {
  test(`${role}: choosing cost for a searched SKU resolves its cost instead of retail`, async () => {
    const rows = await searchPosProductRows(storeId, "RAP2200", { role });
    const product = rows.find((row) => row.id === productId);
    expect(Number(product.prices[costBookId] ?? product.retailPrice)).toBe(1280000);
    expect(Number(product.prices[tradeBookId])).toBe(1400000);
    expect(product).not.toHaveProperty("costPrice");
    expect(product.prices).not.toHaveProperty(otherCostBookId);
    expect(rows.some((row) => row.sku === "RAP2200-OTHER")).toBe(false);
    const child = rows.find((row) => row.id === parentId).children.find((row) => row.id === productId);
    expect(Number(child.prices[costBookId])).toBe(1280000);
    expect(child).not.toHaveProperty("costPrice");
  });
}

for (const role of ["cashier", "warehouse", undefined]) {
  test(`${role ?? "unspecified role"}: search exposes public catalogue and retail without internal prices`, async () => {
    const rows = await searchPosProductRows(storeId, "RAP2200", { role });
    for (const row of rows.flatMap((product) => [product, ...product.children])) {
      expect(row).not.toHaveProperty("costPrice");
      expect(row.prices).not.toHaveProperty(costBookId);
      expect(row.prices).not.toHaveProperty(purchaseBookId);
      expect(row.priceBookTypes).toEqual({ [listBookId]: "list", [retailBookId]: "retail", [tradeBookId]: null });
      expect(row).not.toHaveProperty("lastPurchasePrice");
      expect(row).not.toHaveProperty("lastPurchaseNetPrice");
    }
    expect(rows.find((row) => row.id === productId).prices[listBookId]).toBe("1800000");
    expect(rows.find((row) => row.id === siblingId).prices[listBookId]).toBeNull();
  });
}

test("a real zero cost is retained instead of falling back to retail", async () => {
  const [product] = await searchPosProductRows(storeId, "ZERO-COST", { role: "owner" });
  expect(Number(product.prices[costBookId] ?? product.retailPrice)).toBe(0);
});

for (const role of ["owner", "cashier"]) {
  test(`web and mobile search use the authenticated ${role} role`, async () => {
    accessRole = role;
    const webRows = await searchPosProducts(" RAP2200-E ");
    const response = await GET(new Request("http://localhost/api/mobile/pos/search?q=RAP2200-E"));
    expect(response.status).toBe(200);
    const mobileRows = (await response.json()).data;
    for (const rows of [webRows, mobileRows]) {
      const product = rows.find((row) => row.id === productId);
      expect(product).not.toHaveProperty("costPrice");
      expect(Number(product.prices[costBookId] ?? product.retailPrice))
        .toBe(role === "owner" ? 1280000 : 1490000);
      expect(product.prices[retailBookId]).toBe("1490000");
      expect(product.prices[listBookId]).toBe("1800000");
      expect(product.priceBookTypes[listBookId]).toBe("list");
      expect(product).not.toHaveProperty("lastPurchasePrice");
      expect(product).not.toHaveProperty("lastPurchaseNetPrice");
      if (role === "owner") expect(product.prices[purchaseBookId]).toBe("1260000");
      else expect(product.prices).not.toHaveProperty(purchaseBookId);
    }
  });
}

for (const role of ["owner", "manager"]) {
  test(`${role}: four source projections use received net, company catalogue and retail independently`, async () => {
    const rows = await searchPosProductRows(storeId, "RAP2200", { role });
    const product = rows.find((row) => row.id === productId);
    const parent = rows.find((row) => row.id === parentId);
    expect(Object.keys(product.prices)).toEqual([costBookId, purchaseBookId, listBookId, retailBookId, tradeBookId]);
    expect(Number(product.prices[purchaseBookId])).toBe(1260000);
    expect(product.prices[listBookId]).toBe("1800000");
    expect(product.prices[retailBookId]).toBe("1490000");
    expect(product.priceBookTypes[purchaseBookId]).toBe("purchase");
    expect(parent.prices[purchaseBookId]).toBeNull();
    expect(product).not.toHaveProperty("lastPurchasePrice");
    expect(product).not.toHaveProperty("lastPurchaseNetPrice");
    expect(rows.find((row) => row.id === siblingId).prices[purchaseBookId]).toBeNull();
    expect(rows.find((row) => row.id === siblingId).prices[listBookId]).toBeNull();
    const zero = await searchPosProductRows(storeId, "ZERO-COST", { role });
    expect(zero[0].prices[purchaseBookId]).toBe("0");
    expect(zero[0].prices[listBookId]).toBe("0");
  });
}
test("cashier cannot receive purchase sources through search or nested variants", async () => {
  const rows = await searchPosProductRows(storeId, "RAP2200", { role: "cashier" });
  for (const row of rows.flatMap((product) => [product, ...product.children])) {
    expect(row.prices).not.toHaveProperty(purchaseBookId);
    expect(row.priceBookTypes).not.toHaveProperty(purchaseBookId);
    expect(row).not.toHaveProperty("lastPurchasePrice");
    expect(row).not.toHaveProperty("lastPurchaseNetPrice");
  }
});

for (const role of ["owner", "cashier"]) {
  test(`web and mobile ${role} searches preserve both RAP2200 variant price snapshots`, async () => {
    accessRole = role;
    const webRows = await searchPosProducts("RAP2200");
    const response = await GET(new Request("http://localhost/api/mobile/pos/search?q=RAP2200"));
    expect(response.status).toBe(200);
    const mobileRows = (await response.json()).data;
    const expected = [
      { id: productId, sku: "RAP2200-E", retail: "1490000", list: "1800000", ...(role === "owner" ? { purchase: "1260000" } : {}) },
      { id: siblingId, sku: "RAP2200-F", retail: "1190000", list: null, ...(role === "owner" ? { purchase: null } : {}) },
    ];
    const snapshot = (row) => ({ id: row.id, sku: row.sku, retail: row.prices[retailBookId], list: row.prices[listBookId],
      ...(role === "owner" ? { purchase: row.prices[purchaseBookId] } : {}) });
    for (const rows of [webRows, mobileRows]) {
      const parent = rows.find((row) => row.id === parentId);
      expect(parent.children.map(snapshot)).toEqual(expected);
      expect(rows.filter((row) => row.parentProductId === parentId).map(snapshot)).toEqual(expected);
      for (const row of parent.children) {
        expect(row).not.toHaveProperty("costPrice");
        expect(row).not.toHaveProperty("lastPurchasePrice");
        expect(row).not.toHaveProperty("lastPurchaseNetPrice");
        if (role === "cashier") expect(row.prices).not.toHaveProperty(purchaseBookId);
      }
    }
  });
}
