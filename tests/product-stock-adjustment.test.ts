import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { applyProductStockAdjustment } from "@/lib/products/product-stock-adjustment";
import { changedProductStock, productStockAdjustmentSchema } from "@/lib/products/stock-adjustment";
import { createProductSchema } from "@/app/(app)/products/new/schema";

const storeId = "00000000-0000-4000-8000-000000000001";
const otherStoreId = "00000000-0000-4000-8000-000000000002";
const productId = "10000000-0000-4000-8000-000000000001";
const warehouseId = "20000000-0000-4000-8000-000000000001";
const otherWarehouseId = "20000000-0000-4000-8000-000000000002";
const client = new PGlite();
const database = drizzle(client);

beforeAll(async () => {
  await client.exec(`
    create table categories (id uuid primary key, store_id uuid not null, name text);
    create table products (id uuid primary key, store_id uuid not null, product_kind text not null default 'product', category_id uuid,
      is_variant_parent boolean not null default false, track_batches boolean not null default false);
    create table warehouses (id uuid primary key, store_id uuid not null, is_default boolean not null default false);
    create table stock_levels (store_id uuid not null, product_id uuid not null, warehouse_id uuid not null,
      quantity numeric(14,4) not null default 0, reserved numeric(14,4) not null default 0, min_level numeric(14,4) default 0,
      updated_at timestamptz not null default now(), primary key (store_id,product_id,warehouse_id));
    create table stock_movements (id uuid primary key default gen_random_uuid(), store_id uuid not null, product_id uuid not null,
      warehouse_id uuid not null, type text not null, quantity numeric(14,4) not null, unit_cost numeric(14,2),
      ref_type text, ref_id uuid, note text, created_by uuid, created_at timestamptz not null default now());
  `);
}, 15_000);

beforeEach(async () => {
  await client.exec("truncate stock_movements, stock_levels, products, warehouses, categories");
  await client.query("insert into products (id,store_id) values ($1,$2)", [productId, storeId]);
  await client.query("insert into warehouses (id,store_id,is_default) values ($1,$2,true)", [warehouseId, storeId]);
  await client.query("insert into stock_levels (store_id,product_id,warehouse_id,quantity,reserved,min_level) values ($1,$2,$3,-1,2,3)", [storeId, productId, warehouseId]);
});
afterAll(async () => client.close());

async function adjust(quantity: number, expectedQuantity: number, scope = storeId) {
  return database.transaction(async (tx) => applyProductStockAdjustment(tx as never, {
    storeId: scope, productId, createdBy: null, adjustment: { quantity, expectedQuantity },
  }), { isolationLevel: "serializable" });
}
async function levels() {
  return (await client.query("select quantity::text, reserved::text, min_level::text from stock_levels order by warehouse_id")).rows;
}
async function movements() {
  return (await client.query("select quantity::text, type, ref_type, ref_id from stock_movements")).rows;
}

describe("product stock editing contract", () => {
  test("does not send a stock write when only product information changed", () => {
    expect(changedProductStock(-1, -1)).toBeUndefined();
    expect(changedProductStock(undefined, -1)).toBeUndefined();
    expect(changedProductStock(5, undefined)).toBeUndefined();
    expect(changedProductStock(5, -1)).toEqual({ quantity: 5, expectedQuantity: -1 });
  });
  test("accepts signed fractional current stock but not negative opening stock", () => {
    const base = { name: "IMOU", categoryId: "cameras" };
    expect(createProductSchema.safeParse({ ...base, currentStock: -1.2345 }).success).toBe(true);
    expect(createProductSchema.safeParse({ ...base, initialStock: -1 }).success).toBe(false);
    for (const quantity of [NaN, Infinity, 1e12, 0.00001]) {
      expect(productStockAdjustmentSchema.safeParse({ quantity, expectedQuantity: -1 }).success).toBe(false);
    }
  });
});

describe("product stock persistence", () => {
  test("persists -1 to 5 and records only the +6 adjustment", async () => {
    await adjust(5, -1);
    expect(await levels()).toEqual([{ quantity: "5.0000", reserved: "2.0000", min_level: "3.0000" }]);
    expect(await movements()).toEqual([{ quantity: "6.0000", type: "adjust", ref_type: "product_edit", ref_id: productId }]);
  });
  test("persists zero, negative and fractional balances exactly", async () => {
    await adjust(0, -1);
    await adjust(-2.125, 0);
    expect((await levels())[0].quantity).toBe("-2.1250");
    expect((await movements()).map((row) => row.quantity)).toEqual(["1.0000", "-2.1250"]);
  });
  test("rejects a stale editor without overwriting newer stock or adding history", async () => {
    await adjust(5, -1);
    await expect(adjust(8, -1)).rejects.toThrow("PRODUCT_STOCK_CHANGED");
    expect((await levels())[0].quantity).toBe("5.0000");
    expect(await movements()).toHaveLength(1);
  });
  test("omitted and unchanged stock do not create adjustments", async () => {
    await database.transaction((tx) => applyProductStockAdjustment(tx as never, { storeId, productId, createdBy: null }));
    await adjust(-1, -1);
    expect((await levels())[0].quantity).toBe("-1.0000");
    expect(await movements()).toEqual([]);
  });
  test("rolls stock and audit back if another part of the product save fails", async () => {
    await expect(database.transaction(async (tx) => {
      await applyProductStockAdjustment(tx as never, { storeId, productId, createdBy: null, adjustment: { quantity: 9, expectedQuantity: -1 } });
      throw new Error("product save failed");
    })).rejects.toThrow("product save failed");
    expect((await levels())[0].quantity).toBe("-1.0000");
    expect(await movements()).toEqual([]);
  });
  test("cannot adjust another store's product", async () => {
    await expect(adjust(5, -1, otherStoreId)).rejects.toThrow("PRODUCT_NOT_FOUND");
    expect((await levels())[0].quantity).toBe("-1.0000");
    expect(await movements()).toEqual([]);
  });
  test("initializes missing stock in this store's default warehouse", async () => {
    await client.exec("delete from stock_levels");
    await adjust(2.25, 0);
    expect((await levels())[0].quantity).toBe("2.2500");
    expect((await movements())[0].quantity).toBe("2.2500");
  });
  test("does not invent a warehouse", async () => {
    await client.exec("delete from stock_levels; delete from warehouses");
    await expect(adjust(1, 0)).rejects.toThrow("PRODUCT_STOCK_WAREHOUSE_MISSING");
    expect(await movements()).toEqual([]);
  });
  test("does not silently adjust an arbitrary warehouse in an aggregate", async () => {
    await client.query("insert into stock_levels (store_id,product_id,warehouse_id,quantity) values ($1,$2,$3,2)", [storeId, productId, otherWarehouseId]);
    await expect(adjust(10, 1)).rejects.toThrow("PRODUCT_STOCK_REQUIRES_INVENTORY");
    expect((await levels()).map((row) => row.quantity)).toEqual(["-1.0000", "2.0000"]);
    expect(await movements()).toEqual([]);
  });
  test.each(["track_batches", "is_variant_parent"])("requires inventory workflow for %s", async (field) => {
    await client.exec(`update products set ${field} = true`);
    await expect(adjust(5, -1)).rejects.toThrow("PRODUCT_STOCK_REQUIRES_INVENTORY");
    expect(await movements()).toEqual([]);
  });
  test("does not mix a stock adjustment with enabling lot tracking", async () => {
    await expect(database.transaction((tx) => applyProductStockAdjustment(tx as never, {
      storeId, productId, createdBy: null, adjustment: { quantity: 5, expectedQuantity: -1 }, nextTrackBatches: true,
    }))).rejects.toThrow("PRODUCT_STOCK_REQUIRES_INVENTORY");
    expect(await movements()).toEqual([]);
  });
  test("does not adjust stock while moving the product into the service category", async () => {
    const categoryId = "30000000-0000-4000-8000-000000000001";
    await client.query("insert into categories (id,store_id,name) values ($1,$2,'Dịch vụ')", [categoryId, storeId]);
    await expect(database.transaction((tx) => applyProductStockAdjustment(tx as never, {
      storeId, productId, createdBy: null, adjustment: { quantity: 5, expectedQuantity: -1 }, nextCategoryId: categoryId,
    }))).rejects.toThrow("PRODUCT_STOCK_NOT_MANAGED");
    expect(await movements()).toEqual([]);
  });
  test.each(["service", "combo"])("cannot create physical stock for %s", async (kind) => {
    await client.query("update products set product_kind=$1", [kind]);
    await expect(adjust(5, -1)).rejects.toThrow("PRODUCT_STOCK_NOT_MANAGED");
    expect(await movements()).toEqual([]);
  });
});
