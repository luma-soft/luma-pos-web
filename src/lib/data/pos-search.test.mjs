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
const parentId = randomUUID(), productId = randomUUID(), zeroCostId = randomUUID();
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
  await database.insert(schema.warehouses).values({ storeId, name: "Main", isDefault: true });
  await database.insert(schema.priceBooks).values([
    { id: costBookId, storeId, name: "Giá vốn", costBased: true, managerOnly: true },
    { id: tradeBookId, storeId, name: "Giá thợ" },
    { id: otherCostBookId, storeId: otherStoreId, name: "Giá vốn", costBased: true, managerOnly: true },
  ]);
  await database.insert(schema.products).values([
    { id: parentId, storeId, sku: "RAP2200", name: "RAP2200", isVariantParent: true },
    { id: productId, storeId, sku: "RAP2200-E", name: "RAP2200 E", parentProductId: parentId, costPrice: "1280000", retailPrice: "1490000" },
    { id: zeroCostId, storeId, sku: "ZERO-COST", name: "Zero cost", costPrice: "0", retailPrice: "100000" },
    { storeId: otherStoreId, sku: "RAP2200-OTHER", name: "RAP2200 other store", costPrice: "900000", retailPrice: "1200000" },
  ]);
  await database.insert(schema.productPrices).values({ storeId, productId, priceBookId: tradeBookId, price: "1400000" });
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

for (const role of ["cashier", undefined]) {
  test(`${role ?? "unspecified role"}: search does not expose cost prices`, async () => {
    const rows = await searchPosProductRows(storeId, "RAP2200", { role });
    for (const row of rows.flatMap((product) => [product, ...product.children])) {
      expect(row).not.toHaveProperty("costPrice");
      expect(row.prices).not.toHaveProperty(costBookId);
    }
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
    }
  });
}
