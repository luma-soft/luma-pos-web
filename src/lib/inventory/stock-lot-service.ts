import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { products, stockLotMovements, stockLots } from "@/db/schema";
import { planLotConsumption } from "@/lib/inventory/stock-lot-allocation";

const toQty = (quantity: number) => quantity.toFixed(4);

export type InventoryTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

export async function consumeTrackedStockLots(
  tx: InventoryTransaction,
  input: {
    productId: string;
    warehouseId: string;
    quantity: number;
    refType: string;
    refId: string;
    createdBy: string | null;
  },
) {
  const [product] = await tx
    .select({ trackBatches: products.trackBatches })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (!product?.trackBatches) return [];

  const lots = await tx
    .select({
      id: stockLots.id,
      expiryDate: stockLots.expiryDate,
      availableQuantity: stockLots.availableQuantity,
      receivedAt: stockLots.receivedAt,
    })
    .from(stockLots)
    .where(and(
      eq(stockLots.productId, input.productId),
      eq(stockLots.warehouseId, input.warehouseId),
      gt(stockLots.availableQuantity, "0"),
    ))
    .orderBy(sql`${stockLots.expiryDate} asc nulls last`, asc(stockLots.receivedAt))
    .for("update");

  const allocations = planLotConsumption(lots, input.quantity);
  for (const allocation of allocations) {
    await tx
      .update(stockLots)
      .set({
        availableQuantity: sql`${stockLots.availableQuantity} - ${toQty(allocation.quantity)}`,
      })
      .where(and(
        eq(stockLots.id, allocation.lotId),
        sql`${stockLots.availableQuantity} >= ${toQty(allocation.quantity)}`,
      ));
    await tx.insert(stockLotMovements).values({
      stockLotId: allocation.lotId,
      quantity: toQty(-allocation.quantity),
      refType: input.refType,
      refId: input.refId,
      createdBy: input.createdBy,
    });
  }
  return allocations;
}

export async function recordStockLotReceipt(
  tx: InventoryTransaction,
  input: {
    stockLotId: string;
    quantity: number;
    refType: string;
    refId: string;
    createdBy: string | null;
  },
) {
  await tx.insert(stockLotMovements).values({
    stockLotId: input.stockLotId,
    quantity: toQty(input.quantity),
    refType: input.refType,
    refId: input.refId,
    createdBy: input.createdBy,
  });
}

export async function restoreTrackedStockLots(
  tx: InventoryTransaction,
  input: {
    productId: string;
    quantity: number;
    sourceRefType: string;
    sourceRefId: string;
    refType: string;
    refId: string;
    createdBy: string | null;
  },
) {
  const [product] = await tx
    .select({ trackBatches: products.trackBatches })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (!product?.trackBatches) return [];

  const movements = await tx
    .select({
      lotId: stockLots.id,
      receivedQuantity: stockLots.receivedQuantity,
      availableQuantity: stockLots.availableQuantity,
      movedQuantity: stockLotMovements.quantity,
      expiryDate: stockLots.expiryDate,
    })
    .from(stockLotMovements)
    .innerJoin(stockLots, eq(stockLots.id, stockLotMovements.stockLotId))
    .where(and(
      eq(stockLots.productId, input.productId),
      eq(stockLotMovements.refType, input.sourceRefType),
      eq(stockLotMovements.refId, input.sourceRefId),
      sql`${stockLotMovements.quantity} < 0`,
    ))
    .orderBy(sql`${stockLots.expiryDate} asc nulls last`, asc(stockLotMovements.createdAt))
    .for("update");

  const restorableByLot = new Map<string, {
    id: string;
    expiryDate: string | null;
    availableQuantity: number;
  }>();
  for (const movement of movements) {
    const capacity = Math.max(
      0,
      Number(movement.receivedQuantity) - Number(movement.availableQuantity),
    );
    const moved = Math.abs(Number(movement.movedQuantity));
    const previous = restorableByLot.get(movement.lotId);
    restorableByLot.set(movement.lotId, {
      id: movement.lotId,
      expiryDate: movement.expiryDate,
      availableQuantity: Math.min(
        capacity,
        (previous?.availableQuantity ?? 0) + moved,
      ),
    });
  }

  const totalRestorable = [...restorableByLot.values()]
    .reduce((sum, lot) => sum + lot.availableQuantity, 0);
  if (totalRestorable <= 1e-9) return [];
  const restorations = planLotConsumption(
    [...restorableByLot.values()],
    Math.min(input.quantity, totalRestorable),
  );
  for (const restoration of restorations) {
    await tx
      .update(stockLots)
      .set({
        availableQuantity: sql`${stockLots.availableQuantity} + ${toQty(restoration.quantity)}`,
      })
      .where(eq(stockLots.id, restoration.lotId));
    await tx.insert(stockLotMovements).values({
      stockLotId: restoration.lotId,
      quantity: toQty(restoration.quantity),
      refType: input.refType,
      refId: input.refId,
      createdBy: input.createdBy,
    });
  }
  return restorations;
}

export async function receiveUnspecifiedTrackedStockLot(
  tx: InventoryTransaction,
  input: {
    productId: string;
    warehouseId: string;
    quantity: number;
    batchNumber: string;
    refType: string;
    refId: string;
    createdBy: string | null;
  },
) {
  const [product] = await tx
    .select({
      trackBatches: products.trackBatches,
      costPrice: products.costPrice,
    })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (!product?.trackBatches) return null;

  const [lot] = await tx.insert(stockLots).values({
    productId: input.productId,
    warehouseId: input.warehouseId,
    batchNumber: input.batchNumber.slice(0, 80),
    expiryDate: null,
    receivedQuantity: toQty(input.quantity),
    availableQuantity: toQty(input.quantity),
    unitCost: product.costPrice,
    createdBy: input.createdBy,
  }).returning({ id: stockLots.id });
  await recordStockLotReceipt(tx, {
    stockLotId: lot.id,
    quantity: input.quantity,
    refType: input.refType,
    refId: input.refId,
    createdBy: input.createdBy,
  });
  return lot;
}

export async function restoreOrReceiveTrackedStockLots(
  tx: InventoryTransaction,
  input: {
    productId: string;
    warehouseId: string;
    quantity: number;
    sourceRefType: string;
    sourceRefId: string;
    refType: string;
    refId: string;
    fallbackBatchNumber: string;
    createdBy: string | null;
  },
) {
  const restored = await restoreTrackedStockLots(tx, input);
  const restoredQuantity = restored.reduce((sum, row) => sum + row.quantity, 0);
  const remainder = input.quantity - restoredQuantity;
  if (remainder > 1e-9) {
    await receiveUnspecifiedTrackedStockLot(tx, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: remainder,
      batchNumber: input.fallbackBatchNumber,
      refType: input.refType,
      refId: input.refId,
      createdBy: input.createdBy,
    });
  }
  return restored;
}
