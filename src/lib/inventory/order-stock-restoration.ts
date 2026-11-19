import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { productComboItems, products, stockLevels, stockMovements } from "@/db/schema";
import { restoreOrReceiveTrackedStockLots, type InventoryTransaction } from "./stock-lot-service";

export type OrderStockRestoration = {
  productId: string;
  warehouseId: string;
  quantity: number;
  sourceRefType: "order" | "exchange_order";
};

type OrderItemStockSnapshot = { productId: string; quantity: string; unitMultiplier: string };

/** Resolve the physical stock actually sold, including earlier same-ID edits. */
export async function getOrderStockRestorations(
  tx: InventoryTransaction, storeId: string, order: { id: string; warehouseId: string | null }, items: readonly OrderItemStockSnapshot[],
): Promise<OrderStockRestoration[]> {
  const movements = await tx.select({
    productId: stockMovements.productId, warehouseId: stockMovements.warehouseId,
    quantity: stockMovements.quantity, refType: stockMovements.refType, type: stockMovements.type,
  }).from(stockMovements).where(and(
    eq(stockMovements.storeId, storeId), eq(stockMovements.refId, order.id),
    inArray(stockMovements.refType, ["order", "exchange_order", "order_edit_cancel", "order_cancel"]),
    inArray(stockMovements.type, ["sale", "return_in"]),
  )).orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));
  const grouped = new Map<string, OrderStockRestoration>();
  if (movements.length) {
    for (const movement of movements) {
      const key = `${movement.productId}:${movement.warehouseId}`;
      const target = grouped.get(key) ?? {
        productId: movement.productId, warehouseId: movement.warehouseId, quantity: 0, sourceRefType: "order" as const,
      };
      target.quantity -= Number(movement.quantity);
      if (movement.type === "sale") target.sourceRefType = movement.refType === "exchange_order" ? "exchange_order" : "order";
      grouped.set(key, target);
    }
  } else if (order.warehouseId && items.length) {
    // Imported orders may have no movement ledger. Their reconciled opening
    // stock remains authoritative; resolve only physical items for restoration.
    const ids = [...new Set(items.map((item) => item.productId))];
    const productRows = await tx.select({ id: products.id, kind: products.productKind }).from(products)
      .where(and(eq(products.storeId, storeId), inArray(products.id, ids)));
    const kinds = new Map(productRows.map((product) => [product.id, product.kind]));
    const components = await tx.select({
      comboId: productComboItems.comboProductId, productId: productComboItems.componentProductId, quantity: productComboItems.quantity,
    }).from(productComboItems).innerJoin(products, and(
      eq(products.id, productComboItems.componentProductId), eq(products.storeId, productComboItems.storeId),
    )).where(and(eq(productComboItems.storeId, storeId), inArray(productComboItems.comboProductId, ids), eq(products.productKind, "product")));
    for (const item of items) {
      const baseQuantity = Number(item.quantity) * Number(item.unitMultiplier);
      const physical = kinds.get(item.productId) === "product"
        ? [{ productId: item.productId, quantity: baseQuantity }]
        : kinds.get(item.productId) === "combo"
          ? components.filter((component) => component.comboId === item.productId)
            .map((component) => ({ productId: component.productId, quantity: Number(component.quantity) * baseQuantity }))
          : [];
      for (const stockItem of physical) {
        const key = `${stockItem.productId}:${order.warehouseId}`;
        const target = grouped.get(key) ?? {
          productId: stockItem.productId, warehouseId: order.warehouseId, quantity: 0, sourceRefType: "order" as const,
        };
        target.quantity += stockItem.quantity;
        grouped.set(key, target);
      }
    }
  }
  return [...grouped.values()].map((target) => ({ ...target, quantity: Number(target.quantity.toFixed(4)) }))
    .filter((target) => target.quantity > 0)
    .sort((a, b) => a.productId.localeCompare(b.productId) || a.warehouseId.localeCompare(b.warehouseId));
}

/** Call with affected product locks already held, before replacement sales. */
export async function restoreOrderStockInTransaction(tx: InventoryTransaction, input: {
  storeId: string;
  orderId: string;
  orderCode: string;
  targets: readonly OrderStockRestoration[];
  refType: "order_cancel" | "order_edit_cancel";
  createdBy: string | null;
}) {
  for (const target of input.targets) {
    await restoreOrReceiveTrackedStockLots(tx, {
      storeId: input.storeId, productId: target.productId, warehouseId: target.warehouseId, quantity: target.quantity,
      sourceRefType: target.sourceRefType, sourceRefId: input.orderId, refType: input.refType, refId: input.orderId,
      fallbackBatchNumber: `Hoàn ${input.orderCode}`, createdBy: input.createdBy,
    });
    await tx.insert(stockLevels).values({
      storeId: input.storeId, productId: target.productId, warehouseId: target.warehouseId, quantity: target.quantity.toFixed(4),
    }).onConflictDoUpdate({
      target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
      set: { quantity: sql`${stockLevels.quantity} + ${target.quantity.toFixed(4)}`, updatedAt: sql`now()` },
    });
    await tx.insert(stockMovements).values({
      storeId: input.storeId, productId: target.productId, warehouseId: target.warehouseId,
      type: "return_in", quantity: target.quantity.toFixed(4), refType: input.refType, refId: input.orderId,
      note: `Hoàn kho đơn ${input.orderCode}`, createdBy: input.createdBy,
    });
  }
}
