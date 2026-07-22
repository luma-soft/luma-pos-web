"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  installedAssets,
  orders,
  projects,
  serviceCostEntries,
  serviceHandoverDocuments,
  serviceMaintenancePlans,
  serviceJobMaterials,
  serviceJobs,
  serviceStatusLogs,
  warrantyClaims,
} from "@/db/schema";
import {
  type ActionResult,
  generateCode,
  isUniqueViolation,
  requireManager,
  requireStockAccess,
  toMoney,
  toQty,
} from "@/lib/actions/common";
import {
  canTransitionWarrantyClaim,
  canTransitionServiceJob,
  createDefaultChecklist,
  isServiceTypeAllowedForProject,
  validateServiceLinks,
  type ServiceChecklistItem,
} from "@/lib/services/domain";
import {
  installedAssetCreateSchema,
  type InstalledAssetCreateInput,
  installedAssetUpdateSchema,
  type InstalledAssetUpdateInput,
  serviceJobCreateSchema,
  type ServiceJobCreateInput,
  serviceJobMaterialSchema,
  type ServiceJobMaterialInput,
  serviceCostEntrySchema,
  type ServiceCostEntryInput,
  serviceMaterialStockSyncSchema,
  type ServiceMaterialStockSyncInput,
  serviceMaterialReservationSchema,
  type ServiceMaterialReservationInput,
  serviceHandoverDocumentSchema,
  type ServiceHandoverDocumentInput,
  serviceMaintenancePlanSchema,
  type ServiceMaintenancePlanInput,
  serviceJobUpdateSchema,
  type ServiceJobUpdateInput,
  serviceJobTransitionSchema,
  type ServiceJobTransitionInput,
  serviceProjectCreateSchema,
  type ServiceProjectCreateInput,
  warrantyClaimCreateSchema,
  type WarrantyClaimCreateInput,
  warrantyClaimTransitionSchema,
  type WarrantyClaimTransitionInput,
  warrantyClaimUpdateSchema,
  type WarrantyClaimUpdateInput,
} from "@/lib/services/schemas";
import { Routes } from "@/lib/routes";
import { writeAuditLog } from "@/lib/audit";
import { releaseServiceJobMaterialReservationsCore, reserveServiceJobMaterialStockCore, syncServiceJobMaterialStockCore } from "@/lib/services/material-stock";

function revalidateServiceProject(projectId?: string) {
  revalidatePath(Routes.Services);
  revalidatePath(Routes.Partners);
  revalidatePath(Routes.Projects);
  if (projectId) revalidatePath(Routes.project(projectId));
}

async function auditServiceMutation(actorUserId: string, action: string, entityType: string, entityId: string | null, metadata?: Record<string, unknown>) {
  await writeAuditLog({ actorUserId, source: "manual", action, entityType, entityId, metadata });
}

async function loadJobProject(jobId?: string | null) {
  if (!jobId) return undefined;
  const [job] = await db.select({ projectId: serviceJobs.projectId })
    .from(serviceJobs)
    .where(eq(serviceJobs.id, jobId))
    .limit(1);
  return job ?? null;
}

async function loadAssetProject(assetId?: string | null) {
  if (!assetId) return undefined;
  const [asset] = await db.select({ projectId: installedAssets.projectId })
    .from(installedAssets)
    .where(eq(installedAssets.id, assetId))
    .limit(1);
  return asset ?? null;
}

async function loadOrderProject(orderId?: string | null) {
  if (!orderId) return undefined;
  const [order] = await db.select({ projectId: orders.projectId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return order ?? null;
}

async function serviceLinksAreValid(projectId: string, links: {
  jobId?: string | null;
  assetId?: string | null;
  quoteOrderId?: string | null;
  materialOrderId?: string | null;
}) {
  const [job, asset, quoteOrder, materialOrder] = await Promise.all([
    loadJobProject(links.jobId),
    loadAssetProject(links.assetId),
    loadOrderProject(links.quoteOrderId),
    loadOrderProject(links.materialOrderId),
  ]);
  return validateServiceLinks({ projectId, job, asset, quoteOrder, materialOrder });
}

async function isServiceProject(projectId: string) {
  const [project] = await db.select({ serviceType: projects.serviceType })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return Boolean(project?.serviceType);
}

export async function createServiceProject(
  input: ServiceProjectCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = serviceProjectCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    const [project] = await db.insert(projects).values({
      name: value.name,
      customerId: value.customerId ?? null,
      address: value.address || null,
      serviceType: value.serviceType,
      serviceStage: value.serviceStage,
      startsOn: value.startsOn ?? null,
      targetEndsOn: value.targetEndsOn ?? null,
      siteContactName: value.siteContactName || null,
      siteContactPhone: value.siteContactPhone || null,
      note: value.note || null,
    }).returning({ id: projects.id });
    revalidateServiceProject(project.id);
    return { ok: true, data: project };
  } catch (error) {
    console.error("createServiceProject failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function createServiceJob(
  input: ServiceJobCreateInput,
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = serviceJobCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    const [project] = await db.select({ id: projects.id, serviceType: projects.serviceType })
      .from(projects)
      .where(eq(projects.id, value.projectId))
      .limit(1);
    if (!project?.serviceType) return { ok: false, error: "services.errors.projectRequired" };
    if (!isServiceTypeAllowedForProject(project.serviceType, value.serviceType)) {
      return { ok: false, error: "services.errors.tradeMismatch" };
    }
    if (!await serviceLinksAreValid(value.projectId, {
      quoteOrderId: value.quoteOrderId,
      materialOrderId: value.materialOrderId,
    })) return { ok: false, error: "services.errors.relationMismatch" };

    const code = generateCode("DV");
    const [job] = await db.insert(serviceJobs).values({
      projectId: value.projectId,
      code,
      serviceType: value.serviceType,
      title: value.title,
      priority: value.priority,
      assignedTo: value.assignedTo ?? null,
      scheduledAt: value.scheduledAt ? new Date(value.scheduledAt) : null,
      description: value.description || null,
      checklist: createDefaultChecklist(value.serviceType),
      quoteOrderId: value.quoteOrderId ?? null,
      materialOrderId: value.materialOrderId ?? null,
      createdBy: gate.userId,
    }).returning({ id: serviceJobs.id, code: serviceJobs.code });

    await db.update(projects).set({ serviceStage: "active" }).where(eq(projects.id, value.projectId));
    revalidateServiceProject(value.projectId);
    return { ok: true, data: job };
  } catch (error) {
    console.error("createServiceJob failed:", error);
    return { ok: false, error: isUniqueViolation(error) ? "services.errors.duplicateCode" : "errors.serverError" };
  }
}

export async function updateServiceJob(
  input: ServiceJobUpdateInput,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = serviceJobUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    const [current] = await db.select({
      projectId: serviceJobs.projectId,
      projectType: projects.serviceType,
    }).from(serviceJobs)
      .innerJoin(projects, eq(serviceJobs.projectId, projects.id))
      .where(eq(serviceJobs.id, value.jobId))
      .limit(1);
    if (!current?.projectType) return { ok: false, error: "errors.notFound" };
    if (!isServiceTypeAllowedForProject(current.projectType, value.serviceType)) {
      return { ok: false, error: "services.errors.tradeMismatch" };
    }
    if (!await serviceLinksAreValid(current.projectId, {
      quoteOrderId: value.quoteOrderId,
      materialOrderId: value.materialOrderId,
    })) return { ok: false, error: "services.errors.relationMismatch" };

    await db.update(serviceJobs).set({
      serviceType: value.serviceType,
      title: value.title,
      priority: value.priority,
      assignedTo: value.assignedTo ?? null,
      scheduledAt: value.scheduledAt ? new Date(value.scheduledAt) : null,
      description: value.description || null,
      quoteOrderId: value.quoteOrderId ?? null,
      materialOrderId: value.materialOrderId ?? null,
      updatedAt: new Date(),
    }).where(eq(serviceJobs.id, value.jobId));
    revalidateServiceProject(current.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("updateServiceJob failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function transitionServiceJob(
  input: ServiceJobTransitionInput,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = serviceJobTransitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select({
        projectId: serviceJobs.projectId,
        status: serviceJobs.status,
      }).from(serviceJobs).where(eq(serviceJobs.id, value.jobId)).limit(1);
      if (!current) return { ok: false as const, error: "errors.notFound" };
      if (!canTransitionServiceJob(current.status, value.status)) {
        return { ok: false as const, error: "services.errors.invalidTransition" };
      }
      if (current.status === value.status) {
        return { ok: true as const, projectId: current.projectId };
      }

      await tx.update(serviceJobs).set({
        status: value.status,
        completedAt: value.status === "completed" ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(serviceJobs.id, value.jobId));
      await tx.insert(serviceStatusLogs).values({
        jobId: value.jobId,
        fromStatus: current.status,
        toStatus: value.status,
        note: value.note || null,
        createdBy: gate.userId,
      });

      const rows = await tx.select({ status: serviceJobs.status })
        .from(serviceJobs)
        .where(eq(serviceJobs.projectId, current.projectId));
      const countable = rows.filter((row) => row.status !== "cancelled");
      const completed = countable.filter((row) => row.status === "completed").length;
      const progressPercent = countable.length === 0
        ? 0
        : Math.round((completed / countable.length) * 100);
      const serviceStage = value.status === "warranty"
        ? "warranty" as const
        : progressPercent === 100
          ? "completed" as const
          : "active" as const;
      await tx.update(projects).set({ progressPercent, serviceStage })
        .where(eq(projects.id, current.projectId));
      return { ok: true as const, projectId: current.projectId };
    });

    if (!result.ok) return result;
    revalidateServiceProject(result.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("transitionServiceJob failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateServiceChecklist(
  jobId: string,
  checklist: ServiceChecklistItem[],
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  if (!Array.isArray(checklist) || checklist.some((item) =>
    !item || typeof item.code !== "string" || typeof item.labelKey !== "string" || typeof item.completed !== "boolean"
  )) return { ok: false, error: "errors.invalidData" };

  try {
    const [job] = await db.update(serviceJobs).set({ checklist, updatedAt: new Date() })
      .where(eq(serviceJobs.id, jobId))
      .returning({ projectId: serviceJobs.projectId });
    if (!job) return { ok: false, error: "errors.notFound" };
    revalidateServiceProject(job.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("updateServiceChecklist failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function saveServiceJobMaterial(
  input: ServiceJobMaterialInput,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = serviceJobMaterialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    await db.insert(serviceJobMaterials).values({
      jobId: value.jobId,
      productId: value.productId,
      unitName: value.unitName,
      plannedQuantity: toQty(value.plannedQuantity),
      usedQuantity: toQty(value.usedQuantity),
      note: value.note || null,
    }).onConflictDoUpdate({
      target: [serviceJobMaterials.jobId, serviceJobMaterials.productId, serviceJobMaterials.unitName],
      set: {
        plannedQuantity: toQty(value.plannedQuantity),
        usedQuantity: toQty(value.usedQuantity),
        note: value.note || null,
        updatedAt: new Date(),
      },
    });
    const [job] = await db.select({ projectId: serviceJobs.projectId })
      .from(serviceJobs).where(eq(serviceJobs.id, value.jobId)).limit(1);
    revalidateServiceProject(job?.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("saveServiceJobMaterial failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function syncServiceJobMaterialStock(
  input: ServiceMaterialStockSyncInput,
): Promise<ActionResult<{ issuedBaseQuantity: number }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = serviceMaterialStockSyncSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    const result = await db.transaction((tx) => syncServiceJobMaterialStockCore(tx, {
      materialId: value.materialId,
      warehouseId: value.warehouseId,
      createdBy: gate.userId,
    }));

    revalidateServiceProject(result.projectId);
    revalidatePath(Routes.Inventory);
    return { ok: true, data: { issuedBaseQuantity: result.issuedBaseQuantity } };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SERVICE_MATERIAL_NOT_FOUND") return { ok: false, error: "errors.notFound" };
    if (code === "INVALID_SERVICE_MATERIAL_UNIT") return { ok: false, error: "services.errors.invalidMaterialUnit" };
    if (code === "SERVICE_MATERIAL_WAREHOUSE_MISMATCH") return { ok: false, error: "services.errors.materialWarehouseMismatch" };
    if (code === "INSUFFICIENT_SERVICE_MATERIAL_STOCK" || code === "INSUFFICIENT_BATCH_STOCK") {
      return { ok: false, error: "services.errors.insufficientMaterialStock" };
    }
    console.error("syncServiceJobMaterialStock failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function reserveServiceJobMaterial(
  input: ServiceMaterialReservationInput,
): Promise<ActionResult<{ quantityBase: number }>> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  const parsed = serviceMaterialReservationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  try {
    const result = await db.transaction((tx) => reserveServiceJobMaterialStockCore(tx, { ...parsed.data, createdBy: gate.userId }));
    revalidateServiceProject(result.projectId);
    revalidatePath(Routes.Inventory);
    await auditServiceMutation(gate.userId, "reserve_material", "service_material", parsed.data.materialId, { warehouseId: parsed.data.warehouseId, quantity: parsed.data.quantity });
    return { ok: true, data: { quantityBase: result.quantityBase } };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SERVICE_MATERIAL_NOT_FOUND") return { ok: false, error: "errors.notFound" };
    if (code === "INVALID_SERVICE_MATERIAL_UNIT") return { ok: false, error: "services.errors.invalidMaterialUnit" };
    if (code === "SERVICE_MATERIAL_RESERVATION_EXCEEDS_PLAN") return { ok: false, error: "services.errors.reservationExceedsPlan" };
    if (code === "INSUFFICIENT_SERVICE_MATERIAL_STOCK") return { ok: false, error: "services.errors.insufficientMaterialStock" };
    console.error("reserveServiceJobMaterial failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function releaseServiceJobMaterialReservations(materialId: string): Promise<ActionResult> {
  const gate = await requireStockAccess();
  if (!gate.ok) return gate;
  try {
    const result = await db.transaction((tx) => releaseServiceJobMaterialReservationsCore(tx, { materialId }));
    revalidateServiceProject(result.projectId);
    revalidatePath(Routes.Inventory);
    await auditServiceMutation(gate.userId, "release_material_reservation", "service_material", materialId);
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof Error && error.message === "SERVICE_MATERIAL_NOT_FOUND") return { ok: false, error: "errors.notFound" };
    console.error("releaseServiceJobMaterialReservations failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function saveServiceHandoverDocument(
  input: ServiceHandoverDocumentInput,
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = serviceHandoverDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;
  try {
    if (!await isServiceProject(value.projectId)) return { ok: false, error: "services.errors.projectRequired" };
    if (value.jobId && !await serviceLinksAreValid(value.projectId, { jobId: value.jobId })) {
      return { ok: false, error: "services.errors.relationMismatch" };
    }
    const values = {
      projectId: value.projectId,
      jobId: value.jobId ?? null,
      type: value.type,
      title: value.title,
      content: value.content || null,
      photoUrls: value.photoUrls,
      signedBy: value.signedBy || null,
      signedAt: value.signedAt ?? null,
      status: value.status,
      updatedAt: new Date(),
    };
    if (value.id) {
      const [document] = await db.update(serviceHandoverDocuments).set(values)
        .where(eq(serviceHandoverDocuments.id, value.id)).returning({ id: serviceHandoverDocuments.id });
      if (!document) return { ok: false, error: "errors.notFound" };
      revalidateServiceProject(value.projectId);
      await auditServiceMutation(gate.userId, "update_service_handover", "service_handover_document", value.id);
      return { ok: true, data: document };
    }
    const [document] = await db.insert(serviceHandoverDocuments).values({ ...values, createdBy: gate.userId })
      .returning({ id: serviceHandoverDocuments.id });
    revalidateServiceProject(value.projectId);
    await auditServiceMutation(gate.userId, "create_service_handover", "service_handover_document", document.id);
    return { ok: true, data: document };
  } catch (error) {
    console.error("saveServiceHandoverDocument failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function deleteServiceHandoverDocument(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    const [document] = await db.delete(serviceHandoverDocuments).where(eq(serviceHandoverDocuments.id, id))
      .returning({ projectId: serviceHandoverDocuments.projectId });
    if (!document) return { ok: false, error: "errors.notFound" };
    revalidateServiceProject(document.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("deleteServiceHandoverDocument failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function saveServiceMaintenancePlan(
  input: ServiceMaintenancePlanInput,
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = serviceMaintenancePlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;
  try {
    if (!await isServiceProject(value.projectId)) return { ok: false, error: "services.errors.projectRequired" };
    if (value.assetId && !await serviceLinksAreValid(value.projectId, { assetId: value.assetId })) return { ok: false, error: "services.errors.relationMismatch" };
    const values = {
      projectId: value.projectId,
      assetId: value.assetId ?? null,
      title: value.title,
      intervalDays: value.intervalDays,
      nextDueOn: value.nextDueOn,
      assignedTo: value.assignedTo ?? null,
      isActive: value.isActive,
      note: value.note || null,
      updatedAt: new Date(),
    };
    if (value.id) {
      const [plan] = await db.update(serviceMaintenancePlans).set(values).where(eq(serviceMaintenancePlans.id, value.id)).returning({ id: serviceMaintenancePlans.id });
      if (!plan) return { ok: false, error: "errors.notFound" };
      revalidateServiceProject(value.projectId);
      await auditServiceMutation(gate.userId, "update_service_maintenance", "service_maintenance_plan", value.id);
      return { ok: true, data: plan };
    }
    const [plan] = await db.insert(serviceMaintenancePlans).values({ ...values, createdBy: gate.userId }).returning({ id: serviceMaintenancePlans.id });
    revalidateServiceProject(value.projectId);
    await auditServiceMutation(gate.userId, "create_service_maintenance", "service_maintenance_plan", plan.id);
    return { ok: true, data: plan };
  } catch (error) {
    console.error("saveServiceMaintenancePlan failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function completeServiceMaintenancePlan(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    const [current] = await db.select({ projectId: serviceMaintenancePlans.projectId, intervalDays: serviceMaintenancePlans.intervalDays, isActive: serviceMaintenancePlans.isActive })
      .from(serviceMaintenancePlans).where(eq(serviceMaintenancePlans.id, id)).limit(1);
    if (!current) return { ok: false, error: "errors.notFound" };
    const completedOn = new Date();
    const nextDueOn = new Date(completedOn);
    nextDueOn.setDate(nextDueOn.getDate() + current.intervalDays);
    await db.update(serviceMaintenancePlans).set({ lastCompletedOn: completedOn.toISOString().slice(0, 10), nextDueOn: nextDueOn.toISOString().slice(0, 10), updatedAt: completedOn }).where(eq(serviceMaintenancePlans.id, id));
    revalidateServiceProject(current.projectId);
    await auditServiceMutation(gate.userId, "complete_service_maintenance", "service_maintenance_plan", id);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("completeServiceMaintenancePlan failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function deleteServiceMaintenancePlan(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    const [plan] = await db.delete(serviceMaintenancePlans).where(eq(serviceMaintenancePlans.id, id)).returning({ projectId: serviceMaintenancePlans.projectId });
    if (!plan) return { ok: false, error: "errors.notFound" };
    revalidateServiceProject(plan.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("deleteServiceMaintenancePlan failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function saveServiceCostEntry(
  input: ServiceCostEntryInput,
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = serviceCostEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;
  const amount = value.quantity * value.unitCost;

  try {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(eq(projects.id, value.projectId)).limit(1);
    if (!project) return { ok: false, error: "errors.notFound" };
    if (value.jobId) {
      const [job] = await db.select({ projectId: serviceJobs.projectId }).from(serviceJobs)
        .where(eq(serviceJobs.id, value.jobId)).limit(1);
      if (!job || job.projectId !== value.projectId) return { ok: false, error: "services.errors.relationMismatch" };
    }
    if (value.id) {
      const [entry] = await db.update(serviceCostEntries).set({
        jobId: value.jobId ?? null,
        type: value.type,
        description: value.description,
        quantity: toQty(value.quantity),
        unitCost: toMoney(value.unitCost),
        amount: toMoney(amount),
        staffId: value.staffId ?? null,
        incurredOn: value.incurredOn,
        note: value.note || null,
        updatedAt: new Date(),
      }).where(eq(serviceCostEntries.id, value.id)).returning({ id: serviceCostEntries.id });
      if (!entry) return { ok: false, error: "errors.notFound" };
      revalidateServiceProject(value.projectId);
      await auditServiceMutation(gate.userId, "update_service_cost", "service_cost_entry", value.id);
      return { ok: true, data: entry };
    }
    const [entry] = await db.insert(serviceCostEntries).values({
      projectId: value.projectId,
      jobId: value.jobId ?? null,
      type: value.type,
      description: value.description,
      quantity: toQty(value.quantity),
      unitCost: toMoney(value.unitCost),
      amount: toMoney(amount),
      staffId: value.staffId ?? null,
      incurredOn: value.incurredOn,
      note: value.note || null,
      createdBy: gate.userId,
    }).returning({ id: serviceCostEntries.id });
    revalidateServiceProject(value.projectId);
    await auditServiceMutation(gate.userId, "create_service_cost", "service_cost_entry", entry.id, { type: value.type, amount });
    return { ok: true, data: entry };
  } catch (error) {
    console.error("saveServiceCostEntry failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function deleteServiceCostEntry(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    const [entry] = await db.delete(serviceCostEntries).where(eq(serviceCostEntries.id, id))
      .returning({ projectId: serviceCostEntries.projectId });
    if (!entry) return { ok: false, error: "errors.notFound" };
    revalidateServiceProject(entry.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("deleteServiceCostEntry failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function createInstalledAsset(
  input: InstalledAssetCreateInput,
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = installedAssetCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    if (!await isServiceProject(value.projectId)) {
      return { ok: false, error: "services.errors.projectRequired" };
    }
    if (!await serviceLinksAreValid(value.projectId, { jobId: value.jobId })) {
      return { ok: false, error: "services.errors.relationMismatch" };
    }
    const [asset] = await db.insert(installedAssets).values({
      projectId: value.projectId,
      jobId: value.jobId ?? null,
      productId: value.productId ?? null,
      assetKind: value.assetKind,
      name: value.name,
      brand: value.brand || null,
      model: value.model || null,
      serialNumber: value.serialNumber || null,
      macAddress: value.macAddress || null,
      ipAddress: value.ipAddress || null,
      locationLabel: value.locationLabel || null,
      installedAt: value.installedAt ? new Date(value.installedAt) : null,
      customerWarrantyEndsOn: value.customerWarrantyEndsOn ?? null,
      supplierWarrantyEndsOn: value.supplierWarrantyEndsOn ?? null,
      note: value.note || null,
      createdBy: gate.userId,
    }).returning({ id: installedAssets.id });
    revalidateServiceProject(value.projectId);
    return { ok: true, data: asset };
  } catch (error) {
    console.error("createInstalledAsset failed:", error);
    return { ok: false, error: isUniqueViolation(error) ? "services.errors.duplicateSerial" : "errors.serverError" };
  }
}

export async function updateInstalledAsset(
  input: InstalledAssetUpdateInput,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = installedAssetUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    const [current] = await db.select({ projectId: installedAssets.projectId })
      .from(installedAssets)
      .where(eq(installedAssets.id, value.assetId))
      .limit(1);
    if (!current) return { ok: false, error: "errors.notFound" };
    if (!await serviceLinksAreValid(current.projectId, { jobId: value.jobId })) {
      return { ok: false, error: "services.errors.relationMismatch" };
    }

    await db.update(installedAssets).set({
      jobId: value.jobId ?? null,
      productId: value.productId ?? null,
      assetKind: value.assetKind,
      name: value.name,
      brand: value.brand || null,
      model: value.model || null,
      serialNumber: value.serialNumber || null,
      macAddress: value.macAddress || null,
      ipAddress: value.ipAddress || null,
      locationLabel: value.locationLabel || null,
      installedAt: value.installedAt ? new Date(value.installedAt) : null,
      customerWarrantyEndsOn: value.customerWarrantyEndsOn ?? null,
      supplierWarrantyEndsOn: value.supplierWarrantyEndsOn ?? null,
      status: value.status,
      note: value.note || null,
      updatedAt: new Date(),
    }).where(eq(installedAssets.id, value.assetId));
    revalidateServiceProject(current.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("updateInstalledAsset failed:", error);
    return { ok: false, error: isUniqueViolation(error) ? "services.errors.duplicateSerial" : "errors.serverError" };
  }
}

export async function createWarrantyClaim(
  input: WarrantyClaimCreateInput,
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = warrantyClaimCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    if (!await isServiceProject(value.projectId)) {
      return { ok: false, error: "services.errors.projectRequired" };
    }
    if (!await serviceLinksAreValid(value.projectId, { jobId: value.jobId, assetId: value.assetId })) {
      return { ok: false, error: "services.errors.relationMismatch" };
    }
    const code = generateCode("BH");
    const [claim] = await db.insert(warrantyClaims).values({
      projectId: value.projectId,
      jobId: value.jobId ?? null,
      assetId: value.assetId ?? null,
      code,
      title: value.title,
      description: value.description || null,
      priority: value.priority,
      scheduledAt: value.scheduledAt ? new Date(value.scheduledAt) : null,
      createdBy: gate.userId,
    }).returning({ id: warrantyClaims.id, code: warrantyClaims.code });
    revalidateServiceProject(value.projectId);
    return { ok: true, data: claim };
  } catch (error) {
    console.error("createWarrantyClaim failed:", error);
    return { ok: false, error: isUniqueViolation(error) ? "services.errors.duplicateCode" : "errors.serverError" };
  }
}

export async function updateWarrantyClaim(
  input: WarrantyClaimUpdateInput,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = warrantyClaimUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    const [current] = await db.select({ projectId: warrantyClaims.projectId })
      .from(warrantyClaims)
      .where(eq(warrantyClaims.id, value.claimId))
      .limit(1);
    if (!current) return { ok: false, error: "errors.notFound" };
    if (!await serviceLinksAreValid(current.projectId, { jobId: value.jobId, assetId: value.assetId })) {
      return { ok: false, error: "services.errors.relationMismatch" };
    }

    await db.update(warrantyClaims).set({
      jobId: value.jobId ?? null,
      assetId: value.assetId ?? null,
      title: value.title,
      description: value.description || null,
      priority: value.priority,
      scheduledAt: value.scheduledAt ? new Date(value.scheduledAt) : null,
      laborCharge: toMoney(value.laborCharge),
      materialCharge: toMoney(value.materialCharge),
      updatedAt: new Date(),
    }).where(eq(warrantyClaims.id, value.claimId));
    revalidateServiceProject(current.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("updateWarrantyClaim failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function transitionWarrantyClaim(
  input: WarrantyClaimTransitionInput,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = warrantyClaimTransitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const value = parsed.data;

  try {
    const [current] = await db.select({
      projectId: warrantyClaims.projectId,
      status: warrantyClaims.status,
    }).from(warrantyClaims).where(eq(warrantyClaims.id, value.claimId)).limit(1);
    if (!current) return { ok: false, error: "errors.notFound" };
    if (!canTransitionWarrantyClaim(current.status, value.status)) {
      return { ok: false, error: "services.errors.invalidTransition" };
    }
    await db.update(warrantyClaims).set({
      status: value.status,
      diagnosis: value.diagnosis || undefined,
      resolution: value.resolution || undefined,
      resolvedAt: value.status === "resolved" || value.status === "closed" ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(warrantyClaims.id, value.claimId));
    if (value.status !== current.status) {
      await db.update(projects).set({ serviceStage: "warranty" })
        .where(eq(projects.id, current.projectId));
    }
    revalidateServiceProject(current.projectId);
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("transitionWarrantyClaim failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}
