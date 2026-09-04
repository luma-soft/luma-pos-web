import type { db } from "@/db";
import { recordManualInventoryCost } from "@/lib/inventory/cost-valuation";
import {
  brands,
  categories,
  productComboItems,
  products,
  productSourceMappings,
  productUnits,
  stockLevels,
  stockMovements,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type {
  ProductSyncTransaction,
  SetProductStockInput,
} from "./product-sync-runner";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PROVIDER = "kiotviet";
const STOCK_EPSILON = 1e-9;

function decimal(value: number, scale: number): string {
  return value.toFixed(scale);
}

function nullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function limitedText(value: string, length: number, fallback: string): string {
  return (value.trim() || fallback).slice(0, length);
}

export function createKiotVietProductSyncTransaction(input: {
  transaction: DatabaseTransaction;
  storeId: string;
  warehouseId: string;
  runId: string;
}): ProductSyncTransaction {
  const { transaction, storeId, warehouseId, runId } = input;
  const categoryIds = new Map<string, string>();
  const brandIds = new Map<string, string>();

  async function ensureCategory(path: string[]): Promise<string | null> {
    let parentId: string | null = null;
    for (const rawName of path) {
      const name = rawName.trim();
      if (!name) continue;
      const cachedId = categoryIds.get(name);
      if (cachedId) {
        parentId = cachedId;
        continue;
      }
      const [existing] = await transaction
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.storeId, storeId), eq(categories.name, name)))
        .limit(1);
      const id: string = existing?.id ?? (await transaction
        .insert(categories)
        .values({ storeId, name, parentId })
        .returning({ id: categories.id }))[0].id;
      categoryIds.set(name, id);
      parentId = id;
    }
    return parentId;
  }

  async function ensureBrand(rawName: string): Promise<string | null> {
    const name = rawName.trim();
    if (!name) return null;
    const cachedId = brandIds.get(name);
    if (cachedId) return cachedId;
    const [existing] = await transaction
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.storeId, storeId), eq(brands.name, name)))
      .limit(1);
    const id = existing?.id ?? (await transaction
      .insert(brands)
      .values({ storeId, name })
      .returning({ id: brands.id }))[0].id;
    brandIds.set(name, id);
    return id;
  }

  async function setStock(stock: SetProductStockInput): Promise<void> {
    const updatedAt = new Date();
    await transaction
      .insert(stockLevels)
      .values({
        storeId,
        productId: stock.productId,
        warehouseId,
        quantity: decimal(stock.quantity, 4),
        minLevel: decimal(stock.minLevel, 4),
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
        set: {
          quantity: decimal(stock.quantity, 4),
          minLevel: decimal(stock.minLevel, 4),
          updatedAt,
        },
      });
    await transaction
      .update(products)
      .set({
        totalStock: decimal(stock.quantity, 4),
        minStock: decimal(stock.minLevel, 4),
        updatedAt,
      })
      .where(and(eq(products.storeId, storeId), eq(products.id, stock.productId)));
    if (Math.abs(stock.delta) <= STOCK_EPSILON) return;
    await transaction.insert(stockMovements).values({
      storeId,
      productId: stock.productId,
      warehouseId,
      type: stock.isCreate ? "init" : "adjust",
      quantity: decimal(stock.delta, 4),
      unitCost: decimal(stock.unitCost, 2),
      refType: "kiotviet_product_sync",
      refId: runId,
      note: "Đồng bộ tồn kho từ KiotViet",
    });
  }

  return {
    async upsertProduct({ productId, source }) {
      const categoryId = await ensureCategory(source.categoryPath);
      const brandId = await ensureBrand(source.brand);
      const now = new Date();
      const managedValues = {
        sku: limitedText(source.sku, 50, source.sku),
        barcode: nullableText(source.barcode)?.slice(0, 50) ?? null,
        name: source.name,
        productKind: source.productKind,
        description: nullableText(source.description),
        categoryId,
        brandId,
        baseUnit: limitedText(source.baseUnit, 20, "cái"),
        costPrice: decimal(source.costPrice, 2),
        retailPrice: decimal(source.retailPrice, 2),
        vatRate: source.vatRate == null ? null : decimal(source.vatRate, 2),
        weight: source.weight == null ? null : decimal(source.weight, 3),
        location: nullableText(source.location),
        specs: source.specs,
        imageUrls: source.imageUrls,
        isActive: source.isActive,
        lifecycleStatus: source.isActive ? "active" : "archived",
        updatedAt: now,
      } as const;
      if (productId) {
        await recordManualInventoryCost(transaction, storeId, productId, source.costPrice);
        await transaction
          .update(products)
          .set(managedValues)
          .where(and(eq(products.storeId, storeId), eq(products.id, productId)));
        return productId;
      }
      const [created] = await transaction
        .insert(products)
        .values({ storeId, ...managedValues })
        .returning({ id: products.id });
      return created.id;
    },

    async replaceUnits(productId, units) {
      await transaction
        .delete(productUnits)
        .where(and(eq(productUnits.storeId, storeId), eq(productUnits.productId, productId)));
      if (units.length === 0) return;
      await transaction.insert(productUnits).values(units.map((unit, index) => ({
        storeId,
        productId,
        sku: limitedText(unit.sku, 50, unit.sku),
        unitName: limitedText(unit.unitName, 30, "đv"),
        multiplier: decimal(unit.multiplier, 4),
        barcode: nullableText(unit.barcode)?.slice(0, 50) ?? null,
        priceOverride: unit.priceOverride == null ? null : decimal(unit.priceOverride, 2),
        sortOrder: index,
      })));
    },

    setStock,

    async upsertSourceMapping(mapping) {
      const now = new Date();
      await transaction
        .insert(productSourceMappings)
        .values({
          storeId,
          productId: mapping.productId,
          provider: PROVIDER,
          externalId: mapping.externalId,
          lastSeenAt: mapping.lastSeenAt,
          deletedAt: mapping.deletedAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            productSourceMappings.storeId,
            productSourceMappings.provider,
            productSourceMappings.externalId,
          ],
          set: {
            productId: mapping.productId,
            lastSeenAt: mapping.lastSeenAt,
            deletedAt: mapping.deletedAt,
            updatedAt: now,
          },
        });
    },

    async markSourceDeleted(mapping) {
      await transaction
        .update(productSourceMappings)
        .set({ deletedAt: mapping.deletedAt, updatedAt: new Date() })
        .where(and(
          eq(productSourceMappings.storeId, storeId),
          eq(productSourceMappings.provider, PROVIDER),
          eq(productSourceMappings.productId, mapping.productId),
        ));
    },

    async replaceComboItems(productId, components) {
      await transaction
        .delete(productComboItems)
        .where(and(
          eq(productComboItems.storeId, storeId),
          eq(productComboItems.comboProductId, productId),
        ));
      if (components.length === 0) return;
      await transaction.insert(productComboItems).values(components.map((component, index) => ({
        storeId,
        comboProductId: productId,
        componentProductId: component.productId,
        quantity: decimal(component.quantity, 4),
        sortOrder: index,
      })));
    },

    async setRelatedProduct(productId, relatedProductId) {
      await transaction
        .update(products)
        .set({ relatedProductId, updatedAt: new Date() })
        .where(and(eq(products.storeId, storeId), eq(products.id, productId)));
    },

    async archiveProduct(action) {
      await transaction
        .update(products)
        .set({ isActive: false, lifecycleStatus: "archived", updatedAt: sql`now()` })
        .where(and(eq(products.storeId, storeId), eq(products.id, action.productId)));
    },
  };
}
