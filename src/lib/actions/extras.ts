"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, projects, promotions } from "@/db/schema";
import { type ActionResult, requireUser, requireManager } from "./common";
import { Routes } from "@/lib/routes";

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

export async function createProject(input: CreateProjectInput): Promise<ActionResult<{ id: string }>> {
  try {
    await requireUser();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const [row] = await db.insert(projects).values({
      name: v.name.trim(),
      customerId: v.customerId ?? null,
      address: v.address?.trim() || null,
      note: v.note || null,
    }).returning({ id: projects.id });
    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Projects);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("createProject failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function toggleProjectStatus(id: string): Promise<ActionResult> {
  try {
    await requireUser();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  try {
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
    }).where(eq(projects.id, id));
    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Projects);
    revalidatePath(Routes.project(id));
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("toggleProjectStatus failed:", e);
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
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  const parsed = promoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.insert(promotions).values({
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
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
    await db.update(promotions).set({ isActive: sql`not ${promotions.isActive}` }).where(eq(promotions.id, id));
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
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(20)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await db.update(customers).set({ portalToken: token }).where(eq(customers.id, customerId));
    revalidatePath(Routes.customer(customerId));
    return { ok: true, data: { token } };
  } catch (e) {
    console.error("generatePortalToken failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateProject(input: UpdateProjectInput): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  const parsed = projectUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    const isServiceProject = Boolean(v.serviceType);
    const serviceStage = v.status === "done" ? "completed" : v.serviceStage;
    await db.update(projects).set({
      name: v.name.trim(),
      customerId: v.customerId ?? null,
      address: v.address?.trim() || null,
      note: v.note?.trim() || null,
      status: v.status,
      ...(isServiceProject ? {
        serviceType: v.serviceType,
        serviceStage,
        startsOn: v.startsOn ?? null,
        targetEndsOn: v.targetEndsOn ?? null,
        siteContactName: v.siteContactName || null,
        siteContactPhone: v.siteContactPhone || null,
        ...(v.status === "done" ? { progressPercent: 100 } : {}),
      } : {}),
    }).where(eq(projects.id, v.id));
    revalidatePath(Routes.Partners);
    revalidatePath(Routes.Projects);
    revalidatePath(Routes.Services);
    revalidatePath(Routes.project(v.id));
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateProject failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
