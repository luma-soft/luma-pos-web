import { and, eq, sql } from "drizzle-orm";
import {
  products,
  productUnits,
  serviceJobMaterials,
  serviceJobs,
  stockLevels,
  stockMovements,
} from "@/db/schema";
import {
  consumeTrackedStockLots,
  restoreOrReceiveTrackedStockLots,
  type InventoryTransaction,
} from "@/lib/inventory/stock-lot-service";
import { calculateServiceMaterialStockSync } from "@/lib/services/domain";

const toQty = (quantity: number) => quantity.toFixed(4);

export async function syncServiceJobMaterialStockCore(
  tx: InventoryTransaction,
  input: { materialId: string; warehouseId: string; createdBy: string | null },
) {
  const [material] = await tx.select({
    id: serviceJobMaterials.id,
    productId: serviceJobMaterials.productId,
    unitName: serviceJobMaterials.unitName,
    usedQuantity: serviceJobMaterials.usedQuantity,
    projectId: serviceJobs.projectId,
    jobCode: serviceJobs.code,
    productName: products.name,
    baseUnit: products.baseUnit,
    unitCost: products.costPrice,
  }).from(serviceJobMaterials)
    .innerJoin(serviceJobs, eq(serviceJobMaterials.jobId, serviceJobs.id))
    .innerJoin(products, eq(serviceJobMaterials.productId, products.id))
    .where(eq(serviceJobMaterials.id, input.materialId))
    .limit(1);
  if (!material) throw new Error("SERVICE_MATERIAL_NOT_FOUND");

  let unitMultiplier = 1;
  if (material.unitName !== material.baseUnit) {
    const [unit] = await tx.select({ multiplier: productUnits.multiplier })
      .from(productUnits)
      .where(and(
        eq(productUnits.productId, material.productId),
        eq(productUnits.unitName, material.unitName),
      ))
      .limit(1);
    unitMultiplier = Number(unit?.multiplier ?? 0);
  }

  const movements = await tx.select({
    warehouseId: stockMovements.warehouseId,
    quantity: stockMovements.quantity,
  }).from(stockMovements).where(and(
    eq(stockMovements.refType, "service_material"),
    eq(stockMovements.refId, material.id),
  ));
  const issuedBaseQuantity = Math.max(0, -movements.reduce((sum, row) => sum + Number(row.quantity), 0));
  const stockSync = calculateServiceMaterialStockSync(
    Number(material.usedQuantity),
    unitMultiplier,
    issuedBaseQuantity,
  );
  if (!stockSync) throw new Error("INVALID_SERVICE_MATERIAL_UNIT");

  const movementWarehouseId = movements[0]?.warehouseId;
  if (movementWarehouseId && movementWarehouseId !== input.warehouseId) {
    throw new Error("SERVICE_MATERIAL_WAREHOUSE_MISMATCH");
  }
  const warehouseId = movementWarehouseId ?? input.warehouseId;
  const delta = stockSync.deltaBaseQuantity;
  if (Math.abs(delta) < 0.0001) {
    return { projectId: material.projectId, issuedBaseQuantity: stockSync.targetBaseQuantity };
  }

  if (delta > 0) {
    const [level] = await tx.select({ quantity: stockLevels.quantity, reserved: stockLevels.reserved })
      .from(stockLevels)
      .where(and(
        eq(stockLevels.productId, material.productId),
        eq(stockLevels.warehouseId, warehouseId),
      ))
      .for("update")
      .limit(1);
    if (!level || Number(level.quantity) - Number(level.reserved) < delta) {
      throw new Error("INSUFFICIENT_SERVICE_MATERIAL_STOCK");
    }
    await consumeTrackedStockLots(tx, {
      productId: material.productId,
      warehouseId,
      quantity: delta,
      refType: "service_material",
      refId: material.id,
      createdBy: input.createdBy,
    });
    await tx.update(stockLevels).set({
      quantity: sql`${stockLevels.quantity} - ${toQty(delta)}`,
      updatedAt: sql`now()`,
    }).where(and(
      eq(stockLevels.productId, material.productId),
      eq(stockLevels.warehouseId, warehouseId),
    ));
  } else {
    const restoreQuantity = Math.abs(delta);
    await restoreOrReceiveTrackedStockLots(tx, {
      productId: material.productId,
      warehouseId,
      quantity: restoreQuantity,
      sourceRefType: "service_material",
      sourceRefId: material.id,
      refType: "service_material",
      refId: material.id,
      fallbackBatchNumber: `DV-${material.jobCode}`,
      createdBy: input.createdBy,
    });
    await tx.insert(stockLevels).values({
      productId: material.productId,
      warehouseId,
      quantity: toQty(restoreQuantity),
    }).onConflictDoUpdate({
      target: [stockLevels.productId, stockLevels.warehouseId],
      set: {
        quantity: sql`${stockLevels.quantity} + ${toQty(restoreQuantity)}`,
        updatedAt: sql`now()`,
      },
    });
  }

  await tx.insert(stockMovements).values({
    productId: material.productId,
    warehouseId,
    type: "internal_use",
    quantity: toQty(-delta),
    unitCost: material.unitCost,
    refType: "service_material",
    refId: material.id,
    note: `${material.jobCode} · ${material.productName}`,
    createdBy: input.createdBy,
  });
  return { projectId: material.projectId, issuedBaseQuantity: stockSync.targetBaseQuantity };
}
