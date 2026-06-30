"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
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
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const saved = await db.transaction(async (tx) => {
      if (v.isDefault) {
        await tx.update(labelTemplates).set({ isDefault: false, updatedAt: sql`now()` });
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
            isDefault: v.isDefault,
            isActive: v.isActive,
            sortOrder: v.sortOrder,
            updatedAt: sql`now()`,
          })
          .where(eq(labelTemplates.id, v.id))
          .returning({ id: labelTemplates.id });
        return row;
      }

      const [row] = await tx
        .insert(labelTemplates)
        .values({
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
          isDefault: v.isDefault,
          isActive: v.isActive,
          sortOrder: v.sortOrder,
        })
        .returning({ id: labelTemplates.id });
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
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
    const [source] = await db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).limit(1);
    if (!source) return { ok: false, error: "errors.notFound" };
    const [row] = await db.insert(labelTemplates).values({
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
      isDefault: false,
      isActive: true,
      sortOrder: source.sortOrder + 1,
    }).returning({ id: labelTemplates.id });
    revalidateLabelTemplatePaths();
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("duplicateLabelTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function setDefaultLabelTemplate(id: string): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
    await db.transaction(async (tx) => {
      await tx.update(labelTemplates).set({ isDefault: false, updatedAt: sql`now()` });
      await tx.update(labelTemplates).set({ isDefault: true, isActive: true, updatedAt: sql`now()` }).where(eq(labelTemplates.id, id));
    });
    revalidateLabelTemplatePaths();
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setDefaultLabelTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function deactivateLabelTemplate(id: string): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  try {
    const [row] = await db.select({ isDefault: labelTemplates.isDefault }).from(labelTemplates).where(eq(labelTemplates.id, id)).limit(1);
    if (!row) return { ok: false, error: "errors.notFound" };
    if (row.isDefault) return { ok: false, error: "labelSettings.errors.defaultRequired" };
    await db.update(labelTemplates).set({ isActive: false, updatedAt: sql`now()` }).where(eq(labelTemplates.id, id));
    revalidateLabelTemplatePaths();
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("deactivateLabelTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
