import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import {
  planKiotVietProductSync,
} from "../src/lib/kiotviet/product-sync.ts";
import {
  applyKiotVietProductSync,
} from "../src/lib/kiotviet/product-sync-runner.ts";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const client = new PGlite();
const database = drizzle(client, { schema });
const STORE_ID = "00000000-0000-4000-8000-000000000001";
const WAREHOUSE_ID = "84000000-0000-4000-8000-000000000001";
const RUN_ID = "84000000-0000-4000-8000-000000000002";

async function applySqlFile(path) {
  const contents = readFileSync(path, "utf8");
  for (const statement of contents
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) {
      await client.exec(statement);
    }
  }
}

const product = (sku, stock, comboComponents = []) => ({
  sku,
  barcode: `${sku}-BARCODE`,
  name: `${sku} source name`,
  productKind: comboComponents.length > 0 ? "combo" : "product",
  categoryPath: ["Kiot group", "Kiot leaf"],
  brand: "Kiot brand",
  baseUnit: comboComponents.length > 0 ? "combo" : "cái",
  costPrice: 10,
  retailPrice: 20,
  vatRate: 8,
  stock,
  minLevel: 2,
  location: "A-01",
  description: "Kiot description",
  weight: 1.5,
  imageUrls: ["https://img.example/product.jpg"],
  isActive: true,
  directSale: true,
  relatedSku: null,
  specs: { SIZE: ["21"] },
  comboComponents,
});

let partId;
let deletedId;
let lumaId;
let customPriceBookId;

beforeAll(async () => {
  await client.exec("create role anon; create role authenticated;");
  for (const name of readdirSync(`${projectRoot}/drizzle`)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${name}`);
  }

  await database.insert(schema.warehouses).values({
    id: WAREHOUSE_ID,
    storeId: STORE_ID,
    name: "Kiot sync warehouse",
    isDefault: true,
  });
  [partId, deletedId, lumaId] = (await database.insert(schema.products).values([
    { storeId: STORE_ID, sku: "PART", name: "Old part", costPrice: "1", retailPrice: "2" },
    { storeId: STORE_ID, sku: "DELETED", name: "Deleted source product" },
    { storeId: STORE_ID, sku: "LUMA", name: "Luma only", retailPrice: "777" },
  ]).returning({ id: schema.products.id })).map((row) => row.id);
  await database.insert(schema.stockLevels).values({
    storeId: STORE_ID,
    productId: partId,
    warehouseId: WAREHOUSE_ID,
    quantity: "1",
    minLevel: "0",
  });
  [customPriceBookId] = (await database.insert(schema.priceBooks).values({
    storeId: STORE_ID,
    name: "Kiot sync custom book",
    isDefault: false,
  }).returning({ id: schema.priceBooks.id })).map((row) => row.id);
  await database.insert(schema.productPrices).values({
    storeId: STORE_ID,
    priceBookId: customPriceBookId,
    productId: partId,
    price: "999",
  });
});

afterAll(async () => client.close());

describe("KiotViet product sync Drizzle transaction", () => {
  test("persists only managed product state and preserves custom Luma price overrides", async () => {
    const { createKiotVietProductSyncTransaction } = await import(
      "../src/lib/kiotviet/product-sync-database.ts"
    );
    const snapshot = {
      products: [
        product("PART", 4),
        {
          ...product("COMBO", 0, [{ sku: "PART", quantity: 2 }]),
          relatedSku: "PART",
        },
      ],
      units: [{
        sku: "PART-BOX",
        baseSku: "PART",
        unitName: "Box",
        multiplier: 4,
        barcode: "PART-BOX-BARCODE",
        priceOverride: 80,
        sourceStock: 1,
      }],
    };
    const plan = planKiotVietProductSync({
      snapshot,
      currentProducts: [
        { id: partId, sku: "PART", stock: 1, isActive: true },
        { id: deletedId, sku: "DELETED", stock: 0, isActive: true },
        { id: lumaId, sku: "LUMA", stock: 0, isActive: true },
      ],
      sourceMappings: [],
      historicalSkus: new Set(["DELETED"]),
    });
    const seenAt = new Date("2026-08-30T16:00:00.000Z");

    await applyKiotVietProductSync({
      snapshot,
      plan,
      seenAt,
      runInTransaction: (work) => database.transaction((transaction) => work(
        createKiotVietProductSyncTransaction({
          transaction,
          storeId: STORE_ID,
          warehouseId: WAREHOUSE_ID,
          runId: RUN_ID,
        }),
      )),
    });

    const syncedProducts = await database.select({
      id: schema.products.id,
      sku: schema.products.sku,
      name: schema.products.name,
      costPrice: schema.products.costPrice,
      retailPrice: schema.products.retailPrice,
      totalStock: schema.products.totalStock,
      isActive: schema.products.isActive,
      lifecycleStatus: schema.products.lifecycleStatus,
      relatedProductId: schema.products.relatedProductId,
    }).from(schema.products).where(eq(schema.products.storeId, STORE_ID));
    const bySku = new Map(syncedProducts.map((row) => [row.sku, row]));
    expect(bySku.get("PART")).toMatchObject({
      id: partId,
      name: "PART source name",
      costPrice: "10.00",
      retailPrice: "20.00",
      totalStock: "4.0000",
      isActive: true,
      lifecycleStatus: "active",
    });
    expect(bySku.get("COMBO")).toMatchObject({
      name: "COMBO source name",
      relatedProductId: partId,
      isActive: true,
      lifecycleStatus: "active",
    });
    expect(bySku.get("DELETED")).toMatchObject({
      id: deletedId,
      isActive: false,
      lifecycleStatus: "archived",
    });
    expect(bySku.get("LUMA")).toMatchObject({
      id: lumaId,
      name: "Luma only",
      retailPrice: "777.00",
      isActive: true,
    });

    const units = await database.select().from(schema.productUnits)
      .where(and(eq(schema.productUnits.storeId, STORE_ID), eq(schema.productUnits.productId, partId)));
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      sku: "PART-BOX",
      unitName: "Box",
      multiplier: "4.0000",
      priceOverride: "80.00",
    });

    const stock = await database.select().from(schema.stockLevels)
      .where(and(eq(schema.stockLevels.storeId, STORE_ID), eq(schema.stockLevels.productId, partId)));
    expect(stock[0]).toMatchObject({ quantity: "4.0000", minLevel: "2.0000" });
    const movements = await database.select().from(schema.stockMovements)
      .where(and(eq(schema.stockMovements.storeId, STORE_ID), eq(schema.stockMovements.productId, partId)));
    expect(movements.map((row) => ({ type: row.type, quantity: row.quantity, refId: row.refId })))
      .toEqual([{ type: "adjust", quantity: "3.0000", refId: RUN_ID }]);

    const mappings = await database.select().from(schema.productSourceMappings)
      .where(eq(schema.productSourceMappings.storeId, STORE_ID));
    expect(mappings.map((row) => ({ externalId: row.externalId, deleted: row.deletedAt != null })).sort((a, b) => a.externalId.localeCompare(b.externalId)))
      .toEqual([
        { externalId: "COMBO", deleted: false },
        { externalId: "DELETED", deleted: true },
        { externalId: "PART", deleted: false },
      ]);

    const combo = bySku.get("COMBO");
    const comboItems = await database.select().from(schema.productComboItems)
      .where(eq(schema.productComboItems.comboProductId, combo.id));
    expect(comboItems.map((row) => ({ componentProductId: row.componentProductId, quantity: row.quantity })))
      .toEqual([{ componentProductId: partId, quantity: "2.0000" }]);

    const priceOverrides = await database.select().from(schema.productPrices)
      .where(and(
        eq(schema.productPrices.storeId, STORE_ID),
        eq(schema.productPrices.priceBookId, customPriceBookId),
      ));
    expect(priceOverrides.map((row) => ({ productId: row.productId, price: row.price })))
      .toEqual([{ productId: partId, price: "999.00" }]);
  });
});
