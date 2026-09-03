"use server";

import { isDeepStrictEqual } from "node:util";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { recordActivity } from "@/lib/audit/activity-log";
import { labelTemplates } from "@/db/schema";
import { type ActionResult, requireManager } from "./common";

const saveSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  widthMm: z.number().min(10).max(120),
  heightMm: z.number().min(8).max(80),
  columns: z.number().int().min(1).max(6),
  gapMm: z.number().min(0).max(20),
  barcodeType: z.literal("code128").default("code128"),
  showName: z.boolean(),
  showSku: z.boolean(),
  showPrice: z.boolean(),
  showUnit: z.boolean(),
  showBarcodeText: z.boolean(),
  showStoreName: z.boolean(),
  barcodeHeightMm: z.number().min(6).max(40).default(10),
  barcodeQuietMm: z.number().min(0).max(10).default(2),
  fontScale: z.number().min(0.75).max(1.5).default(1),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export type SaveLabelTemplateInput = z.input<typeof saveSchema>;

function revalidateLabelTemplatePaths() {
  revalidatePath("/settings/labels");
  revalidatePath("/products/[id]/labels", "page");
}

export async function saveLabelTemplate(input: SaveLabelTemplateInput): Promise<ActionResult<{ id?: string }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const saved = await db.transaction(async (tx) => {
      const [current] = (v.id && !v.id.startsWith("default-")) ? await tx.select().from(labelTemplates)
        .where(and(eq(labelTemplates.storeId, gate.storeId), eq(labelTemplates.id, v.id!))).limit(1).for("update") : [];
      if ((v.id && !v.id.startsWith("default-")) && !current) throw new Error("TEMPLATE_NOT_FOUND");
      const changedFields = Object.keys(v).filter((key) => {
        if (key === "id") return false;
        const value = v[key as keyof typeof v];
        const previous = current?.[key as keyof typeof current];
        return typeof value === "number" ? Number(previous) !== value : !isDeepStrictEqual(previous, value);
      });
      if (current && !changedFields.length) return current;
      if (v.isDefault) {
        await tx.update(labelTemplates).set({ isDefault: false, updatedAt: sql`now()` }).where(eq(labelTemplates.storeId, gate.storeId));
      }

      if (v.id && !v.id.startsWith("default-")) {
        const [row] = await tx
          .update(labelTemplates)
          .set({
            name: v.name,
            widthMm: String(v.widthMm),
            heightMm: String(v.heightMm),
            columns: v.columns,
            gapMm: String(v.gapMm),
            barcodeType: v.barcodeType,
            showName: v.showName,
            showSku: v.showSku,
            showPrice: v.showPrice,
            showUnit: v.showUnit,
            showBarcodeText: v.showBarcodeText,
            showStoreName: v.showStoreName,
            barcodeHeightMm: String(v.barcodeHeightMm),
            barcodeQuietMm: String(v.barcodeQuietMm),
            fontScale: String(v.fontScale),
            isDefault: v.isDefault,
            isActive: v.isActive,
            sortOrder: v.sortOrder,
            updatedAt: sql`now()`,
          })
          .where(and(eq(labelTemplates.storeId, gate.storeId), eq(labelTemplates.id, v.id)))
          .returning({ id: labelTemplates.id });
        await recordActivity(tx, {
          storeId: gate.storeId, actorId: gate.userId, action: "label.template.updated", entityType: "label_template", entityId: row.id,
          before: { name: current!.name, isDefault: current!.isDefault, isActive: current!.isActive },
          after: { name: v.name, isDefault: v.isDefault, isActive: v.isActive }, metadata: { changedFields },
        });
        return row;
      }

      const [row] = await tx
        .insert(labelTemplates)
        .values({
          storeId: gate.storeId,
          name: v.name,
          widthMm: String(v.widthMm),
          heightMm: String(v.heightMm),
          columns: v.columns,
          gapMm: String(v.gapMm),
          barcodeType: v.barcodeType,
          showName: v.showName,
          showSku: v.showSku,
          showPrice: v.showPrice,
          showUnit: v.showUnit,
          showBarcodeText: v.showBarcodeText,
          showStoreName: v.showStoreName,
          barcodeHeightMm: String(v.barcodeHeightMm),
          barcodeQuietMm: String(v.barcodeQuietMm),
          fontScale: String(v.fontScale),
          isDefault: v.isDefault,
          isActive: v.isActive,
          sortOrder: v.sortOrder,
        })
        .returning({ id: labelTemplates.id });
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "label.template.created", entityType: "label_template", entityId: row.id,
        after: { name: v.name, isDefault: v.isDefault, isActive: v.isActive },
      });
      return row;
    });
    revalidateLabelTemplatePaths();
    return { ok: true, data: { id: saved?.id } };
  } catch (e) {
    console.error("saveLabelTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function duplicateLabelTemplate(id: string): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    const [source] = await db.select().from(labelTemplates).where(and(eq(labelTemplates.storeId, gate.storeId), eq(labelTemplates.id, id))).limit(1);
    if (!source) return { ok: false, error: "errors.notFound" };
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(labelTemplates).values({
        storeId: gate.storeId,
        name: `${source.name} copy`,
        widthMm: source.widthMm,
        heightMm: source.heightMm,
        columns: source.columns,
        gapMm: source.gapMm,
        barcodeType: source.barcodeType,
        showName: source.showName,
        showSku: source.showSku,
        showPrice: source.showPrice,
        showUnit: source.showUnit,
        showBarcodeText: source.showBarcodeText,
        showStoreName: source.showStoreName,
        barcodeHeightMm: source.barcodeHeightMm,
        barcodeQuietMm: source.barcodeQuietMm,
        fontScale: source.fontScale,
        isDefault: false,
        isActive: true,
        sortOrder: source.sortOrder + 1,
      }).returning({ id: labelTemplates.id, name: labelTemplates.name });
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "label.template.duplicated", entityType: "label_template", entityId: created.id,
        after: { name: created.name, isDefault: false, isActive: true },
        affectedRecords: [{ type: "label_template", id: source.id, name: source.name }],
      });
      return created;
    });
    revalidateLabelTemplatePaths();
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("duplicateLabelTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function setDefaultLabelTemplate(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    await db.transaction(async (tx) => {
      const [source] = await tx.select().from(labelTemplates)
        .where(and(eq(labelTemplates.storeId, gate.storeId), eq(labelTemplates.id, id))).limit(1).for("update");
      if (!source) throw new Error("TEMPLATE_NOT_FOUND");
      if (source.isDefault && source.isActive) return;
      await tx.update(labelTemplates).set({ isDefault: false, updatedAt: sql`now()` }).where(eq(labelTemplates.storeId, gate.storeId));
      await tx.update(labelTemplates).set({ isDefault: true, isActive: true, updatedAt: sql`now()` }).where(and(eq(labelTemplates.storeId, gate.storeId), eq(labelTemplates.id, id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "label.template.default_changed", entityType: "label_template", entityId: id,
        before: { name: source.name, isDefault: source.isDefault, isActive: source.isActive },
        after: { name: source.name, isDefault: true, isActive: true },
      });
    });
    revalidateLabelTemplatePaths();
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setDefaultLabelTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function deactivateLabelTemplate(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  try {
    const [row] = await db.select({ isDefault: labelTemplates.isDefault }).from(labelTemplates).where(and(eq(labelTemplates.storeId, gate.storeId), eq(labelTemplates.id, id))).limit(1);
    if (!row) return { ok: false, error: "errors.notFound" };
    if (row.isDefault) return { ok: false, error: "labelSettings.errors.defaultRequired" };
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(labelTemplates).set({ isActive: false, updatedAt: sql`now()` }).where(and(eq(labelTemplates.storeId, gate.storeId), eq(labelTemplates.id, id), eq(labelTemplates.isActive, true))).returning({ name: labelTemplates.name });
      if (!updated) return;
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "label.template.deactivated", entityType: "label_template", entityId: id,
        before: { name: updated.name, isActive: true }, after: { name: updated.name, isActive: false },
      });
    });
    revalidateLabelTemplatePaths();
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("deactivateLabelTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
