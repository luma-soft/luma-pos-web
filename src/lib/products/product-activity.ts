import { and, eq, sql } from "drizzle-orm";
import type { ActivityDatabase } from "@/lib/audit/activity-log";
import { products, productUnits, productPrices, productSuppliers, productComboItems, productMedia } from "@/db/schema";

/** Compare values without depending on object-key insertion order. */
export function activityValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => activityValuesEqual(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && activityValuesEqual(a[key], b[key]));
  }
  return false;
}

/** Only fields editable by the product form; timestamps and stock have separate semantics. */
export async function readProductActivitySnapshot(database: ActivityDatabase, storeId: string, productId: string) {
  const [product] = await database.select({
    name: products.name, sku: products.sku, barcode: products.barcode,
    productKind: products.productKind, categoryId: products.categoryId, brandId: products.brandId,
    baseUnit: products.baseUnit, costPrice: products.costPrice, retailPrice: products.retailPrice,
    wholesalePrice: products.wholesalePrice, contractorPrice: products.contractorPrice, agentPrice: products.agentPrice,
    vatRate: products.vatRate, priceByWeight: products.priceByWeight, trackBatches: products.trackBatches,
    shelfLifeDays: products.shelfLifeDays, lifecycleStatus: products.lifecycleStatus, isActive: products.isActive,
    location: products.location, description: products.description, specs: products.specs, imageUrls: products.imageUrls,
    units: sql<Record<string, unknown>[]>`coalesce((
      select jsonb_agg(jsonb_build_object('unitName', ${productUnits.unitName}, 'multiplier', ${productUnits.multiplier}, 'barcode', ${productUnits.barcode}, 'priceOverride', ${productUnits.priceOverride}) order by ${productUnits.sortOrder}, ${productUnits.unitName})
      from ${productUnits} where ${productUnits.storeId} = ${storeId} and ${productUnits.productId} = ${products.id}
    ), '[]'::jsonb)`,
    prices: sql<Record<string, unknown>[]>`coalesce((
      select jsonb_agg(jsonb_build_object('priceBookId', ${productPrices.priceBookId}, 'price', ${productPrices.price}) order by ${productPrices.priceBookId})
      from ${productPrices} where ${productPrices.storeId} = ${storeId} and ${productPrices.productId} = ${products.id}
    ), '[]'::jsonb)`,
    suppliers: sql<Record<string, unknown>[]>`coalesce((
      select jsonb_agg(jsonb_build_object('supplierId', ${productSuppliers.supplierId}, 'isPrimary', ${productSuppliers.isPrimary}) order by ${productSuppliers.supplierId})
      from ${productSuppliers} where ${productSuppliers.storeId} = ${storeId} and ${productSuppliers.productId} = ${products.id}
    ), '[]'::jsonb)`,
    comboItems: sql<Record<string, unknown>[]>`coalesce((
      select jsonb_agg(jsonb_build_object('productId', ${productComboItems.componentProductId}, 'quantity', ${productComboItems.quantity}) order by ${productComboItems.sortOrder})
      from ${productComboItems} where ${productComboItems.storeId} = ${storeId} and ${productComboItems.comboProductId} = ${products.id}
    ), '[]'::jsonb)`,
    media: sql<Record<string, unknown>[]>`coalesce((
      select jsonb_agg(jsonb_build_object('mediaObjectId', ${productMedia.mediaObjectId}, 'isPrimary', ${productMedia.isPrimary}) order by ${productMedia.sortOrder})
      from ${productMedia} where ${productMedia.storeId} = ${storeId} and ${productMedia.productId} = ${products.id} and ${productMedia.deletedAt} is null
    ), '[]'::jsonb)`,
  }).from(products).where(and(eq(products.storeId, storeId), eq(products.id, productId))).limit(1);
  return product ?? null;
}

/** Keep the identity and changed fields, rather than duplicating the entire catalog record. */
export function productActivityChanges(before: NonNullable<Awaited<ReturnType<typeof readProductActivitySnapshot>>>, after: NonNullable<Awaited<ReturnType<typeof readProductActivitySnapshot>>>) {
  const keys = Object.keys(after) as (keyof typeof after)[];
  const changed = keys.filter((key) => !activityValuesEqual(before[key], after[key]));
  if (!changed.length) return null;
  return {
    before: { name: before.name, sku: before.sku, ...Object.fromEntries(changed.map((key) => [key, before[key]])) },
    after: { name: after.name, sku: after.sku, ...Object.fromEntries(changed.map((key) => [key, after[key]])) },
  };
}
