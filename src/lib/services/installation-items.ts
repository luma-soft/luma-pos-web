import { recordActivity } from "@/lib/audit/activity-log";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  installedAssets,
  products,
  projects,
  serviceJobEvents,
  serviceJobMaterials,
  serviceJobs,
} from "@/db/schema";
import type { InventoryTransaction } from "@/lib/inventory/stock-lot-service";
import {
  reserveServiceJobMaterialStockCore,
  syncServiceJobMaterialStockCore,
} from "@/lib/services/material-stock";
import type { ServiceInstallationBatch } from "@/lib/services/schemas";

const quantityText = (value: number) => value.toFixed(4);

function installationBatchHash(input: ServiceInstallationBatchCoreInput) {
  return createHash("sha256").update(JSON.stringify({
    projectId: input.projectId,
    jobId: input.jobId,
    stockMode: input.stockMode,
    warehouseId: input.warehouseId ?? null,
    invoiceMode: input.invoiceMode,
    materialOrderId: input.materialOrderId ?? null,
    locationLabel: input.locationLabel ?? null,
    installedAt: input.installedAt ?? null,
    note: input.note ?? null,
    items: input.items,
  })).digest("hex");
}

export type ServiceInstallationBatchCoreInput = ServiceInstallationBatch & {
  storeId: string;
  createdBy: string | null;
};

export async function saveServiceInstallationBatchCore(
  tx: InventoryTransaction,
  input: ServiceInstallationBatchCoreInput,
) {
  const [project] = await tx.select({ id: projects.id, name: projects.name, serviceType: projects.serviceType })
    .from(projects)
    .where(and(eq(projects.storeId, input.storeId), eq(projects.id, input.projectId)))
    .limit(1)
    .for("update");
  if (!project?.serviceType) throw new Error("SERVICE_PROJECT_NOT_FOUND");

  const [job] = await tx.select({ id: serviceJobs.id, projectId: serviceJobs.projectId })
    .from(serviceJobs)
    .where(and(eq(serviceJobs.storeId, input.storeId), eq(serviceJobs.id, input.jobId)))
    .limit(1)
    .for("update");
  if (!job || job.projectId !== input.projectId) throw new Error("SERVICE_RELATION_MISMATCH");

  const inputHash = installationBatchHash(input);
  const [existingBatch] = await tx.select({ payload: serviceJobEvents.payload })
    .from(serviceJobEvents)
    .where(and(
      eq(serviceJobEvents.storeId, input.storeId),
      eq(serviceJobEvents.jobId, input.jobId),
      eq(serviceJobEvents.eventType, "installation_batch_saved"),
      sql`${serviceJobEvents.payload}->>'requestId' = ${input.requestId}`,
    ))
    .limit(1);
  if (existingBatch) {
    if (existingBatch.payload.inputHash !== inputHash) {
      throw new Error("SERVICE_MUTATION_PAYLOAD_CONFLICT");
    }
    const result = existingBatch.payload.result;
    if (!result || typeof result !== "object") throw new Error("SERVICE_MUTATION_RETRY");
    return result as { projectId: string; materialIds: string[]; assetCount: number };
  }

  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const productRows = await tx.select({
    id: products.id,
    name: products.name,
    baseUnit: products.baseUnit,
  }).from(products).where(and(
    eq(products.storeId, input.storeId),
    inArray(products.id, productIds),
  ));
  if (productRows.length !== productIds.length) throw new Error("SERVICE_PRODUCT_NOT_FOUND");
  const productById = new Map(productRows.map((product) => [product.id, product]));

  const materialIds: string[] = [];
  let assetCount = 0;
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) throw new Error("SERVICE_PRODUCT_NOT_FOUND");
    const usedQuantity = item.quantity;
    const [material] = await tx.insert(serviceJobMaterials).values({
      storeId: input.storeId,
      jobId: input.jobId,
      productId: item.productId,
      unitName: item.unitName,
      plannedQuantity: quantityText(item.quantity),
      usedQuantity: quantityText(usedQuantity),
      note: input.note || null,
    }).onConflictDoUpdate({
      target: [serviceJobMaterials.jobId, serviceJobMaterials.productId, serviceJobMaterials.unitName],
      set: {
        plannedQuantity: sql`${serviceJobMaterials.plannedQuantity} + ${quantityText(item.quantity)}`,
        usedQuantity: sql`${serviceJobMaterials.usedQuantity} + ${quantityText(usedQuantity)}`,
        note: input.note || null,
        updatedAt: new Date(),
      },
    }).returning({ id: serviceJobMaterials.id });
    if (!material) throw new Error("SERVICE_MATERIAL_SAVE_FAILED");
    materialIds.push(material.id);

    if (input.stockMode === "reserve") {
      await reserveServiceJobMaterialStockCore(tx, {
        storeId: input.storeId,
        materialId: material.id,
        warehouseId: input.warehouseId!,
        quantity: item.quantity,
        createdBy: input.createdBy,
      });
    } else if (input.stockMode === "issue") {
      await syncServiceJobMaterialStockCore(tx, {
        storeId: input.storeId,
        materialId: material.id,
        warehouseId: input.warehouseId!,
        createdBy: input.createdBy,
      });
    }

    if (item.tracking !== "asset") continue;
    const quantity = Math.trunc(item.quantity);
    const requestKeys = Array.from(
      { length: quantity },
      (_, index) => `${input.requestId}:${item.clientDraftId}:${index + 1}`,
    );
    const existing = await tx.select({ clientRequestId: installedAssets.clientRequestId })
      .from(installedAssets)
      .where(and(
        eq(installedAssets.storeId, input.storeId),
        inArray(installedAssets.clientRequestId, requestKeys),
      ));
    const existingKeys = new Set(existing.flatMap((row) => row.clientRequestId ? [row.clientRequestId] : []));
    const rows = requestKeys.flatMap((requestKey, index) => {
      if (existingKeys.has(requestKey)) return [];
      return [{
        storeId: input.storeId,
        projectId: input.projectId,
        jobId: input.jobId,
        productId: item.productId,
        assetKind: item.assetKind || "device",
        name: item.name || product.name,
        model: item.model || null,
        serialNumber: item.serialNumbers[index] || null,
        locationLabel: input.locationLabel || null,
        installedAt: input.installedAt ? new Date(input.installedAt) : new Date(),
        clientRequestId: requestKey,
        note: input.note || null,
        createdBy: input.createdBy,
      }];
    });
    if (rows.length > 0) await tx.insert(installedAssets).values(rows).onConflictDoNothing();
    assetCount += quantity;
  }

  if (input.invoiceMode === "link") {
    await tx.update(serviceJobs).set({
      materialOrderId: input.materialOrderId!,
      updatedAt: new Date(),
    }).where(and(eq(serviceJobs.storeId, input.storeId), eq(serviceJobs.id, input.jobId)));
  }

  const result = { projectId: input.projectId, materialIds, assetCount };
  await tx.insert(serviceJobEvents).values({
    storeId: input.storeId,
    jobId: input.jobId,
    eventType: "installation_batch_saved",
    actorId: input.createdBy,
    payload: { requestId: input.requestId, inputHash, result },
  });
  await recordActivity(tx, {
    storeId: input.storeId, actorId: input.createdBy, action: "service.installation.saved",
    entityType: "service_project", entityId: input.projectId,
    after: { name: project.name, itemCount: input.items.length, assetCount, stockMode: input.stockMode },
    affectedRecords: productRows.map((product) => ({ type: "product", id: product.id, name: product.name })),
    metadata: { jobId: input.jobId, projectId: input.projectId, invoiceMode: input.invoiceMode },
  });
  return result;
}
