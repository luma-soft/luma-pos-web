"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  products,
  projectNotes,
  projects,
  promotions,
  serviceCoordinationPoints,
  serviceHandoverDocuments,
  serviceJobDependencies,
  serviceJobs,
} from "@/db/schema";
import { type ActionResult, requireManager } from "./common";
import { Routes } from "@/lib/routes";
import { isServiceSnapshotJobLocked } from "@/lib/services/field-api";
import { requireStoreContext } from "@/lib/auth/store-context";
import { evaluateServiceProjectClose } from "@/lib/services/project-close";
import { writeAuditLog } from "@/lib/audit";
import { deleteProjectCore } from "@/lib/projects/delete-project";

// ============ Công trình ============

const projectSchema = z.object({
  name: z.string().min(1, { error: "validation.required" }),
  customerId: z.uuid().nullable().optional(),
  address: z.string().optional(),
  note: z.string().optional(),
});
export type CreateProjectInput = z.input<typeof projectSchema>;

const projectUpdateSchema = projectSchema.extend({
  id: z.uuid(),
  status: z.enum(["active", "done"]).default("active"),
  serviceType: z.enum(["camera", "electrical", "plumbing", "mixed"]).optional(),
  serviceStage: z.enum(["planning", "quoted", "active", "paused", "completed", "warranty", "cancelled"]).optional(),
  startsOn: z.iso.date().nullable().optional(),
  targetEndsOn: z.iso.date().nullable().optional(),
  siteContactName: z.string().trim().optional(),
  siteContactPhone: z.string().trim().max(20).optional(),
});
export type UpdateProjectInput = z.input<typeof projectUpdateSchema>;

async function canCloseServiceProject(
  storeId: string,
  projectId: string,
  serviceType: "camera" | "electrical" | "plumbing" | "mixed",
) {
  const [jobs, handoverDocuments, dependencies, coordinationPoints] =
    await Promise.all([
      db.select({ status: serviceJobs.status }).from(serviceJobs).where(and(
        eq(serviceJobs.storeId, storeId),
        eq(serviceJobs.projectId, projectId),
      )),
      db.select({
        type: serviceHandoverDocuments.type,
        status: serviceHandoverDocuments.status,
      }).from(serviceHandoverDocuments).where(and(
        eq(serviceHandoverDocuments.storeId, storeId),
        eq(serviceHandoverDocuments.projectId, projectId),
      )),
      serviceType === "mixed"
        ? db.select({ status: serviceJobDependencies.status })
          .from(serviceJobDependencies).where(and(
            eq(serviceJobDependencies.storeId, storeId),
            eq(serviceJobDependencies.projectId, projectId),
          ))
        : Promise.resolve([]),
      serviceType === "mixed"
        ? db.select({
          status: serviceCoordinationPoints.status,
          isAcceptanceRequired:
            serviceCoordinationPoints.isAcceptanceRequired,
        }).from(serviceCoordinationPoints).where(and(
          eq(serviceCoordinationPoints.storeId, storeId),
          eq(serviceCoordinationPoints.projectId, projectId),
        ))
        : Promise.resolve([]),
    ]);

  return evaluateServiceProjectClose({
    serviceType,
    jobStatuses: jobs.map((job) => job.status),
    handoverDocuments,
    dependencies,
    coordinationPoints,
  }).canClose;
}

export async function createProject(input: CreateProjectInput): Promise<ActionResult<{ id: string }>> {
  let context;
  try {
    context = await requireStoreContext();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  const initialNote = v.note?.trim();
  try {
    if (v.customerId) {
      const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.storeId, context.storeId), eq(customers.id, v.customerId))).limit(1);
      if (!customer) return { ok: false, error: "errors.invalidData" };
    }
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(projects).values({
        storeId: context.storeId,
        name: v.name.trim(),
        customerId: v.customerId ?? null,
        address: v.address?.trim() || null,
        note: initialNote || null,
      }).returning({ id: projects.id });
      if (initialNote) {
        await tx.insert(projectNotes).values({
          storeId: context.storeId,
          projectId: created.id,
          content: initialNote,
          createdBy: context.userId,
        });
      }
      return created;
    });
    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Services);
    revalidatePath(Routes.Projects);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("createProject failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function toggleProjectStatus(id: string): Promise<ActionResult> {
  let context;
  try {
    context = await requireStoreContext();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  try {
    const [current] = await db.select({
      status: projects.status,
      serviceType: projects.serviceType,
    }).from(projects).where(and(
      eq(projects.storeId, context.storeId),
      eq(projects.id, id),
    )).limit(1);
    if (!current) return { ok: false, error: "errors.notFound" };
    if (
      current.status === "active"
      && current.serviceType
      && !await canCloseServiceProject(context.storeId, id, current.serviceType)
    ) {
      return { ok: false, error: "services.errors.projectCloseBlocked" };
    }
    await db.update(projects).set({
      status: sql`case when ${projects.status} = 'active' then 'done' else 'active' end`,
      serviceStage: sql`case
        when ${projects.serviceType} is null then ${projects.serviceStage}
        when ${projects.status} = 'active' then 'completed'::service_project_stage
        else 'active'::service_project_stage
      end`,
      progressPercent: sql`case
        when ${projects.serviceType} is null then ${projects.progressPercent}
        when ${projects.status} = 'active' then 100
        else ${projects.progressPercent}
      end`,
    }).where(and(eq(projects.storeId, context.storeId), eq(projects.id, id)));
    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Services);
    revalidatePath(Routes.Projects);
    revalidatePath(Routes.project(id));
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("toggleProjectStatus failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

const deleteProjectSchema = z.uuid();

export async function deleteProject(id: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = deleteProjectSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  try {
    const result = await deleteProjectCore(db, {
      storeId: gate.storeId,
      projectId: parsed.data,
      actorId: gate.userId,
    });
    if (result.outcome === "not_found") {
      return { ok: false, error: "errors.notFound" };
    }
    if (result.outcome === "conflict") {
      console.error("deleteProject blocked:", result.reason);
      return { ok: false, error: "projects.errors.deleteConflict" };
    }

    await writeAuditLog({
      actorUserId: gate.userId,
      source: "manual",
      action: "project.delete",
      entityType: "project",
      entityId: result.projectId,
      metadata: {
        managedMediaCount: result.managedMediaCount,
        legacyObjectCount: result.legacyObjectCount,
      },
    });
    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Projects);
    revalidatePath(Routes.Services);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("deleteProject failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

// ============ Khuyến mãi ============

const promoSchema = z.object({
  name: z.string().min(1, { error: "validation.required" }),
  productId: z.uuid(),
  tiers: z.array(z.object({
    minQty: z.number().positive(),
    discountPct: z.number().min(0.1).max(100),
  })).min(1, { error: "promos.errors.needTier" }),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});
export type CreatePromotionInput = z.input<typeof promoSchema>;

export async function createPromotion(input: CreatePromotionInput): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = promoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.storeId, gate.storeId), eq(products.id, v.productId))).limit(1);
    if (!product) return { ok: false, error: "errors.invalidData" };
    await db.insert(promotions).values({
      storeId: gate.storeId,
      name: v.name.trim(),
      productId: v.productId,
      tiers: v.tiers.sort((a, b) => a.minQty - b.minQty),
      startsAt: v.startsAt ? new Date(v.startsAt) : null,
      endsAt: v.endsAt ? new Date(v.endsAt) : null,
    });
    revalidatePath(Routes.Promotions);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("createPromotion failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function togglePromotion(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.update(promotions).set({ isActive: sql`not ${promotions.isActive}` }).where(and(eq(promotions.storeId, gate.storeId), eq(promotions.id, id)));
    revalidatePath(Routes.Promotions);
    revalidatePath(Routes.POS);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("togglePromotion failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

// ============ Portal token ============

export async function generatePortalToken(customerId: string): Promise<ActionResult<{ token: string }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(20)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const [updated] = await db.update(customers).set({ portalToken: token }).where(and(eq(customers.storeId, gate.storeId), eq(customers.id, customerId))).returning({ id: customers.id });
    if (!updated) return { ok: false, error: "errors.notFound" };
    revalidatePath(Routes.customer(customerId));
    return { ok: true, data: { token } };
  } catch (e) {
    console.error("generatePortalToken failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateProject(input: UpdateProjectInput): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = projectUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const [current] = await db.select({
      serviceType: projects.serviceType,
    }).from(projects).where(and(
      eq(projects.storeId, gate.storeId),
      eq(projects.id, v.id),
    )).limit(1);
    if (!current) return { ok: false, error: "errors.notFound" };
    if (v.customerId) {
      const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.storeId, gate.storeId), eq(customers.id, v.customerId))).limit(1);
      if (!customer) return { ok: false, error: "errors.invalidData" };
    }
    const effectiveServiceType = v.serviceType ?? current.serviceType;
    if (
      v.status === "done"
      && effectiveServiceType
      && !await canCloseServiceProject(gate.storeId, v.id, effectiveServiceType)
    ) {
      return { ok: false, error: "services.errors.projectCloseBlocked" };
    }
    const isServiceProject = Boolean(effectiveServiceType);
    const serviceStage = v.status === "done" ? "completed" : v.serviceStage;
    await db.update(projects).set({
      name: v.name.trim(),
      customerId: v.customerId ?? null,
      address: v.address?.trim() || null,
      note: v.note?.trim() || null,
      status: v.status,
      ...(isServiceProject ? {
        serviceType: effectiveServiceType,
        serviceStage,
        startsOn: v.startsOn ?? null,
        targetEndsOn: v.targetEndsOn ?? null,
        siteContactName: v.siteContactName || null,
        siteContactPhone: v.siteContactPhone || null,
        ...(v.status === "done" ? { progressPercent: 100 } : {}),
      } : {}),
    }).where(and(eq(projects.storeId, gate.storeId), eq(projects.id, v.id)));
    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Projects);
    revalidatePath(Routes.Services);
    revalidatePath(Routes.project(v.id));
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateProject failed:", e);
    return {
      ok: false,
      error: isServiceSnapshotJobLocked(e)
        ? "services.errors.signedSnapshotLocked"
        : "errors.serverError",
    };
  }
}

const manualProjectCompletionSchema = z.object({ id: z.uuid() });

/**
 * Explicit manager override for operationally finished service projects.
 * This intentionally bypasses job, acceptance, and signature close guards,
 * but never mutates child jobs or manufactures acceptance records.
 */
export async function completeServiceProjectManually(
  input: z.input<typeof manualProjectCompletionSchema>,
): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = manualProjectCompletionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  try {
    const [current] = await db.select({
      id: projects.id,
      status: projects.status,
      serviceType: projects.serviceType,
      serviceStage: projects.serviceStage,
      progressPercent: projects.progressPercent,
    }).from(projects).where(and(
      eq(projects.storeId, gate.storeId),
      eq(projects.id, parsed.data.id),
    )).limit(1);
    if (!current) return { ok: false, error: "errors.notFound" };
    if (!current.serviceType) {
      return { ok: false, error: "errors.invalidData" };
    }

    await db.update(projects).set({
      status: "done",
      serviceStage: "completed",
      progressPercent: 100,
    }).where(and(
      eq(projects.storeId, gate.storeId),
      eq(projects.id, parsed.data.id),
    ));

    await writeAuditLog({
      actorUserId: gate.userId,
      source: "mobile",
      action: "service_project.manual_complete",
      entityType: "service_project",
      entityId: parsed.data.id,
      before: {
        status: current.status,
        serviceStage: current.serviceStage,
        progressPercent: current.progressPercent,
      },
      after: {
        status: "done",
        serviceStage: "completed",
        progressPercent: 100,
      },
      metadata: {
        bypassedCloseRequirements: true,
        childJobsMutated: false,
        acceptanceRecordsCreated: false,
      },
    });

    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Projects);
    revalidatePath(Routes.Services);
    revalidatePath(Routes.project(parsed.data.id));
    return { ok: true, data: undefined };
  } catch (error) {
    console.error("completeServiceProjectManually failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}
