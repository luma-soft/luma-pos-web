import { and, asc, desc, eq } from "drizzle-orm";
import type { InventoryTransaction } from "@/lib/inventory/stock-lot-service";
import { categories, products, stockLevels, stockMovements, warehouses } from "@/db/schema";
import { isProductStockManaged } from "@/lib/product-stock";
import { productStockAdjustmentSchema, type ProductStockAdjustment } from "./stock-adjustment";
import { recordActivity } from "@/lib/audit/activity-log";

/** Runs inside the product update transaction; never changes opening stock. */
export async function applyProductStockAdjustment(
  tx: InventoryTransaction,
  input: {
    storeId: string;
    productId: string;
    createdBy: string | null;
    adjustment?: ProductStockAdjustment;
    nextTrackBatches?: boolean;
    nextCategoryId?: string | null;
  },
) {
  if (!input.adjustment) return;
  const { quantity, expectedQuantity } = productStockAdjustmentSchema.parse(input.adjustment);
  if (quantity === expectedQuantity) return;

  const [product] = await tx.select({
    name: products.name,
    sku: products.sku,
    productKind: products.productKind,
    categoryName: categories.name,
    isVariantParent: products.isVariantParent,
    trackBatches: products.trackBatches,
  }).from(products)
    .leftJoin(categories, and(eq(categories.storeId, input.storeId), eq(categories.id, products.categoryId)))
    .where(and(eq(products.storeId, input.storeId), eq(products.id, input.productId)))
    .limit(1);
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  if (!isProductStockManaged(product.categoryName, product.productKind)) {
    throw new Error("PRODUCT_STOCK_NOT_MANAGED");
  }
  // An aggregate editor cannot decide which variant, lot or warehouse to count.
  if (product.isVariantParent || product.trackBatches || input.nextTrackBatches) {
    throw new Error("PRODUCT_STOCK_REQUIRES_INVENTORY");
  }
  if (input.nextCategoryId) {
    const [nextCategory] = await tx.select({ name: categories.name }).from(categories)
      .where(and(eq(categories.storeId, input.storeId), eq(categories.id, input.nextCategoryId)))
      .limit(1);
    if (nextCategory && !isProductStockManaged(nextCategory.name, product.productKind)) {
      throw new Error("PRODUCT_STOCK_NOT_MANAGED");
    }
  }

  const levels = await tx.select({
    warehouseId: stockLevels.warehouseId,
    quantity: stockLevels.quantity,
  }).from(stockLevels)
    .where(and(eq(stockLevels.storeId, input.storeId), eq(stockLevels.productId, input.productId)))
    .orderBy(asc(stockLevels.warehouseId))
    .for("update");
  if (levels.length > 1) throw new Error("PRODUCT_STOCK_REQUIRES_INVENTORY");
  const current = Number(levels[0]?.quantity ?? 0);
  if (current !== expectedQuantity) throw new Error("PRODUCT_STOCK_CHANGED");

  let warehouseId = levels[0]?.warehouseId;
  if (!warehouseId) {
    const available = await tx.select({ id: warehouses.id, isDefault: warehouses.isDefault })
      .from(warehouses)
      .where(eq(warehouses.storeId, input.storeId))
      .orderBy(desc(warehouses.isDefault), asc(warehouses.id))
      .limit(2);
    if (!available.length) throw new Error("PRODUCT_STOCK_WAREHOUSE_MISSING");
    if (available.length > 1 && !available[0].isDefault) {
      throw new Error("PRODUCT_STOCK_REQUIRES_INVENTORY");
    }
    warehouseId = available[0].id;
  }

  const changed = levels.length
    ? await tx.update(stockLevels).set({ quantity: quantity.toFixed(4), updatedAt: new Date() })
      .where(and(
        eq(stockLevels.storeId, input.storeId),
        eq(stockLevels.productId, input.productId),
        eq(stockLevels.warehouseId, warehouseId),
        eq(stockLevels.quantity, expectedQuantity.toFixed(4)),
      )).returning({ productId: stockLevels.productId })
    : await tx.insert(stockLevels).values({
      storeId: input.storeId,
      productId: input.productId,
      warehouseId,
      quantity: quantity.toFixed(4),
    }).onConflictDoNothing().returning({ productId: stockLevels.productId });
  if (!changed.length) throw new Error("PRODUCT_STOCK_CHANGED");

  await tx.insert(stockMovements).values({
    storeId: input.storeId,
    productId: input.productId,
    warehouseId,
    type: "adjust",
    quantity: (quantity - current).toFixed(4),
    refType: "product_edit",
    refId: input.productId,
    note: "Điều chỉnh tồn kho khi sửa sản phẩm",
    createdBy: input.createdBy,
  });
  const [warehouse] = await tx.select({ name: warehouses.name }).from(warehouses)
    .where(and(eq(warehouses.storeId, input.storeId), eq(warehouses.id, warehouseId))).limit(1);
  await recordActivity(tx, {
    storeId: input.storeId,
    actorId: input.createdBy,
    action: "product.stock.adjusted",
    entityType: "product",
    entityId: input.productId,
    before: { name: product.name, sku: product.sku, quantity: current, warehouseName: warehouse?.name },
    after: { name: product.name, sku: product.sku, quantity, warehouseName: warehouse?.name },
    metadata: { productName: product.name, productSku: product.sku, warehouseId, quantityDelta: quantity - current },
  });
}
