import { recordActivity } from "@/lib/audit/activity-log";
import { and, eq, sql } from "drizzle-orm";
import {
  products,
  productUnits,
  serviceJobMaterials,
  serviceJobs,
  serviceMaterialAllocations,
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
  input: { storeId: string; materialId: string; warehouseId: string; createdBy: string | null },
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
    .where(and(eq(serviceJobMaterials.storeId, input.storeId), eq(serviceJobMaterials.id, input.materialId)))
    .limit(1);
  if (!material) throw new Error("SERVICE_MATERIAL_NOT_FOUND");

  let unitMultiplier = 1;
  if (material.unitName !== material.baseUnit) {
    const [unit] = await tx.select({ multiplier: productUnits.multiplier })
      .from(productUnits)
      .where(and(
        eq(productUnits.productId, material.productId),
        eq(productUnits.storeId, input.storeId),
        eq(productUnits.unitName, material.unitName),
      ))
      .limit(1);
    unitMultiplier = Number(unit?.multiplier ?? 0);
  }

  const movements = await tx.select({
    warehouseId: stockMovements.warehouseId,
    quantity: stockMovements.quantity,
  }).from(stockMovements).where(and(
    eq(stockMovements.storeId, input.storeId),
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
    const allocations = await tx.select({
      id: serviceMaterialAllocations.id,
      warehouseId: serviceMaterialAllocations.warehouseId,
      remainingQuantity: serviceMaterialAllocations.remainingQuantity,
    }).from(serviceMaterialAllocations)
      .where(and(eq(serviceMaterialAllocations.storeId, input.storeId), eq(serviceMaterialAllocations.materialId, material.id), eq(serviceMaterialAllocations.status, "reserved")))
      .orderBy(serviceMaterialAllocations.createdAt)
      .for("update");
    const reservedWarehouseId = allocations[0]?.warehouseId;
    if (reservedWarehouseId && reservedWarehouseId !== warehouseId) {
      throw new Error("SERVICE_MATERIAL_WAREHOUSE_MISMATCH");
    }
    const ownReserved = allocations.reduce((sum, row) => sum + Number(row.remainingQuantity), 0);
    const [level] = await tx.select({ quantity: stockLevels.quantity, reserved: stockLevels.reserved })
      .from(stockLevels)
      .where(and(
        eq(stockLevels.productId, material.productId),
        eq(stockLevels.storeId, input.storeId),
        eq(stockLevels.warehouseId, warehouseId),
      ))
      .for("update")
      .limit(1);
    if (!level || Number(level.quantity) - Number(level.reserved) + ownReserved < delta) {
      throw new Error("INSUFFICIENT_SERVICE_MATERIAL_STOCK");
    }
    await consumeTrackedStockLots(tx, {
      storeId: input.storeId,
      productId: material.productId,
      warehouseId,
      quantity: delta,
      refType: "service_material",
      refId: material.id,
      createdBy: input.createdBy,
    });
    await tx.update(stockLevels).set({
      quantity: sql`${stockLevels.quantity} - ${toQty(delta)}`,
      reserved: sql`greatest(0, ${stockLevels.reserved} - ${toQty(Math.min(delta, ownReserved))})`,
      updatedAt: sql`now()`,
    }).where(and(
      eq(stockLevels.productId, material.productId),
      eq(stockLevels.storeId, input.storeId),
      eq(stockLevels.warehouseId, warehouseId),
    ));
    let remainingToConsume = delta;
    for (const allocation of allocations) {
      if (remainingToConsume <= 0) break;
      const consumed = Math.min(remainingToConsume, Number(allocation.remainingQuantity));
      const remaining = Number(allocation.remainingQuantity) - consumed;
      await tx.update(serviceMaterialAllocations).set({
        remainingQuantity: toQty(remaining),
        status: remaining <= 0.0001 ? "consumed" : "reserved",
      }).where(and(eq(serviceMaterialAllocations.storeId, input.storeId), eq(serviceMaterialAllocations.id, allocation.id)));
      remainingToConsume -= consumed;
    }
  } else {
    const restoreQuantity = Math.abs(delta);
    await restoreOrReceiveTrackedStockLots(tx, {
      storeId: input.storeId,
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
      storeId: input.storeId,
      productId: material.productId,
      warehouseId,
      quantity: toQty(restoreQuantity),
    }).onConflictDoUpdate({
      target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
      set: {
        quantity: sql`${stockLevels.quantity} + ${toQty(restoreQuantity)}`,
        updatedAt: sql`now()`,
      },
    });
  }

  await tx.insert(stockMovements).values({
    storeId: input.storeId,
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
  await recordActivity(tx, {
    storeId: input.storeId, actorId: input.createdBy,
    action: "service.material.stock.synced", entityType: "service_material", entityId: material.id,
    before: { name: material.productName, issuedBaseQuantity },
    after: { name: material.productName, issuedBaseQuantity: stockSync.targetBaseQuantity },
    metadata: { projectId: material.projectId, warehouseId, quantity: delta },
    affectedRecords: [{ type: "product", id: material.productId, name: material.productName }],
  });
  return { projectId: material.projectId, issuedBaseQuantity: stockSync.targetBaseQuantity };
}

async function loadServiceMaterialForAllocation(tx: InventoryTransaction, storeId: string, materialId: string) {
  const [material] = await tx.select({
    id: serviceJobMaterials.id,
    projectId: serviceJobs.projectId,
    productId: serviceJobMaterials.productId,
    unitName: serviceJobMaterials.unitName,
    plannedQuantity: serviceJobMaterials.plannedQuantity,
    usedQuantity: serviceJobMaterials.usedQuantity,
    baseUnit: products.baseUnit,
    productName: products.name,
  }).from(serviceJobMaterials)
    .innerJoin(serviceJobs, eq(serviceJobMaterials.jobId, serviceJobs.id))
    .innerJoin(products, eq(serviceJobMaterials.productId, products.id))
    .where(and(eq(serviceJobMaterials.storeId, storeId), eq(serviceJobMaterials.id, materialId))).limit(1);
  if (!material) throw new Error("SERVICE_MATERIAL_NOT_FOUND");
  let unitMultiplier = 1;
  if (material.unitName !== material.baseUnit) {
    const [unit] = await tx.select({ multiplier: productUnits.multiplier }).from(productUnits)
      .where(and(eq(productUnits.storeId, storeId), eq(productUnits.productId, material.productId), eq(productUnits.unitName, material.unitName))).limit(1);
    unitMultiplier = Number(unit?.multiplier ?? 0);
  }
  if (!Number.isFinite(unitMultiplier) || unitMultiplier <= 0) throw new Error("INVALID_SERVICE_MATERIAL_UNIT");
  return { ...material, unitMultiplier };
}

export async function reserveServiceJobMaterialStockCore(
  tx: InventoryTransaction,
  input: { storeId: string; materialId: string; warehouseId: string; quantity: number; createdBy: string | null },
) {
  const material = await loadServiceMaterialForAllocation(tx, input.storeId, input.materialId);
  const quantityBase = Math.round(input.quantity * material.unitMultiplier * 10000) / 10000;
  if (!Number.isFinite(quantityBase) || quantityBase <= 0) throw new Error("INVALID_SERVICE_MATERIAL_RESERVATION");
  const [issued] = await tx.select({ issued: sql<string>`coalesce(-sum(${stockMovements.quantity}), 0)` })
    .from(stockMovements).where(and(eq(stockMovements.storeId, input.storeId), eq(stockMovements.refType, "service_material"), eq(stockMovements.refId, material.id)));
  const [reserved] = await tx.select({ reserved: sql<string>`coalesce(sum(${serviceMaterialAllocations.remainingQuantity}), 0)` })
    .from(serviceMaterialAllocations).where(and(eq(serviceMaterialAllocations.storeId, input.storeId), eq(serviceMaterialAllocations.materialId, material.id), eq(serviceMaterialAllocations.status, "reserved")));
  const plannedBase = Number(material.plannedQuantity) * material.unitMultiplier;
  if (Number(issued?.issued ?? 0) + Number(reserved?.reserved ?? 0) + quantityBase > plannedBase + 0.0001) {
    throw new Error("SERVICE_MATERIAL_RESERVATION_EXCEEDS_PLAN");
  }
  const [level] = await tx.select({ quantity: stockLevels.quantity, reserved: stockLevels.reserved })
    .from(stockLevels).where(and(eq(stockLevels.storeId, input.storeId), eq(stockLevels.productId, material.productId), eq(stockLevels.warehouseId, input.warehouseId))).for("update").limit(1);
  if (!level || Number(level.quantity) - Number(level.reserved) < quantityBase) throw new Error("INSUFFICIENT_SERVICE_MATERIAL_STOCK");
  await tx.update(stockLevels).set({ reserved: sql`${stockLevels.reserved} + ${toQty(quantityBase)}`, updatedAt: sql`now()` })
    .where(and(eq(stockLevels.storeId, input.storeId), eq(stockLevels.productId, material.productId), eq(stockLevels.warehouseId, input.warehouseId)));
  await tx.insert(serviceMaterialAllocations).values({
    storeId: input.storeId,
    materialId: material.id,
    warehouseId: input.warehouseId,
    quantity: toQty(quantityBase),
    remainingQuantity: toQty(quantityBase),
    createdBy: input.createdBy,
  });
  await recordActivity(tx, {
    storeId: input.storeId, actorId: input.createdBy, action: "service.material.reserved",
    entityType: "service_material", entityId: material.id,
    before: { name: material.productName, reservedQuantity: Number(reserved?.reserved ?? 0) },
    after: { name: material.productName, reservedQuantity: Number(reserved?.reserved ?? 0) + quantityBase },
    metadata: { projectId: material.projectId, warehouseId: input.warehouseId, quantity: quantityBase },
  });
  return { projectId: material.projectId, quantityBase };
}

export async function releaseServiceJobMaterialReservationsCore(
  tx: InventoryTransaction,
  input: { storeId: string; materialId: string; createdBy?: string | null },
) {
  const allocations = await tx.select({ id: serviceMaterialAllocations.id, warehouseId: serviceMaterialAllocations.warehouseId, remainingQuantity: serviceMaterialAllocations.remainingQuantity })
    .from(serviceMaterialAllocations).where(and(eq(serviceMaterialAllocations.storeId, input.storeId), eq(serviceMaterialAllocations.materialId, input.materialId), eq(serviceMaterialAllocations.status, "reserved"))).for("update");
  for (const allocation of allocations) {
    await tx.update(stockLevels).set({ reserved: sql`greatest(0, ${stockLevels.reserved} - ${allocation.remainingQuantity})`, updatedAt: sql`now()` })
      .where(and(eq(stockLevels.storeId, input.storeId), eq(stockLevels.productId, sql`(select ${serviceJobMaterials.productId} from ${serviceJobMaterials} where ${serviceJobMaterials.storeId} = ${input.storeId} and ${serviceJobMaterials.id} = ${input.materialId})`), eq(stockLevels.warehouseId, allocation.warehouseId)));
    await tx.update(serviceMaterialAllocations).set({ status: "released", remainingQuantity: "0", releasedAt: new Date() }).where(and(eq(serviceMaterialAllocations.storeId, input.storeId), eq(serviceMaterialAllocations.id, allocation.id)));
  }
  const material = await loadServiceMaterialForAllocation(tx, input.storeId, input.materialId);
  if (!material) throw new Error("SERVICE_MATERIAL_NOT_FOUND");
  if (allocations.length) await recordActivity(tx, {
    storeId: input.storeId, actorId: input.createdBy ?? null, action: "service.material.reservation.released",
    entityType: "service_material", entityId: input.materialId,
    before: { name: material.productName, reservedQuantity: allocations.reduce((sum, item) => sum + Number(item.remainingQuantity), 0) },
    after: { name: material.productName, reservedQuantity: 0 }, metadata: { projectId: material.projectId },
  });
  return { projectId: material.projectId };
}
