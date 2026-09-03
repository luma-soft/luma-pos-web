"use server";

import { isDeepStrictEqual } from "node:util";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { recordActivity } from "@/lib/audit/activity-log";
import { printTemplates } from "@/db/schema";
import { type ActionResult, requireManager } from "./common";
import { isPersistedTemplateId } from "@/lib/print/template-shared";

const saveSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  docType: z.enum(["order", "quote", "booking", "purchase", "return", "receipt"]),
  paperDefault: z.enum(["a4", "a5", "k80"]),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  storeName: z.string().max(200).default(""),
  storeAddress: z.string().max(300).default(""),
  storePhone: z.string().max(50).default(""),
  storeTaxCode: z.string().max(30).default(""),
  footerNote: z.string().max(500).default(""),
  options: z.object({
    showSeller: z.boolean(),
    showProject: z.boolean(),
    showDebt: z.boolean(),
    showDiscount: z.boolean(),
    showTax: z.boolean(),
    showLineDiscount: z.boolean(),
    showPaymentQr: z.boolean(),
    showInWords: z.boolean(),
    showSignatures: z.boolean(),
    showSku: z.boolean(),
  }),
});

export type SavePrintTemplateInput = z.input<typeof saveSchema>;

export async function savePrintTemplate(input: SavePrintTemplateInput): Promise<ActionResult<{ id?: string }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const saved = await db.transaction(async (tx) => {
      const [current] = isPersistedTemplateId(v.id) ? await tx.select().from(printTemplates)
        .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, v.id!))).limit(1).for("update") : [];
      if (isPersistedTemplateId(v.id) && !current) throw new Error("TEMPLATE_NOT_FOUND");
      const changedFields = Object.keys(v).filter((key) => {
        if (key === "id") return false;
        const value = v[key as keyof typeof v];
        const previous = current?.[key as keyof typeof current];
        return typeof value === "number" ? Number(previous) !== value : !isDeepStrictEqual(previous, value);
      });
      if (current && !changedFields.length) return current;
      if (v.isDefault) {
        await tx
          .update(printTemplates)
          .set({ isDefault: false, updatedAt: sql`now()` })
          .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.docType, v.docType)));
      }

      if (isPersistedTemplateId(v.id)) {
        const [row] = await tx
          .update(printTemplates)
          .set({
            name: v.name,
            docType: v.docType,
            paperDefault: v.paperDefault,
            isDefault: v.isDefault,
            isActive: v.isActive,
            sortOrder: v.sortOrder,
            storeName: v.storeName,
            storeAddress: v.storeAddress,
            storePhone: v.storePhone,
            storeTaxCode: v.storeTaxCode,
            footerNote: v.footerNote,
            options: v.options,
            updatedAt: sql`now()`,
          })
          .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, v.id!)))
          .returning({ id: printTemplates.id });
        await recordActivity(tx, {
          storeId: gate.storeId, actorId: gate.userId, action: "print.template.updated", entityType: "print_template", entityId: row.id,
          before: { name: current!.name, isDefault: current!.isDefault, isActive: current!.isActive },
          after: { name: v.name, isDefault: v.isDefault, isActive: v.isActive }, metadata: { changedFields },
        });
        return row;
      }

      const [row] = await tx
        .insert(printTemplates)
        .values({
          storeId: gate.storeId,
          name: v.name,
          docType: v.docType,
          paperDefault: v.paperDefault,
          isDefault: v.isDefault,
          isActive: v.isActive,
          sortOrder: v.sortOrder,
          storeName: v.storeName,
          storeAddress: v.storeAddress,
          storePhone: v.storePhone,
          storeTaxCode: v.storeTaxCode,
          footerNote: v.footerNote,
          options: v.options,
        })
        .returning({ id: printTemplates.id });
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "print.template.created", entityType: "print_template", entityId: row.id,
        after: { name: v.name, isDefault: v.isDefault, isActive: v.isActive },
      });
      return row;
    });

    revalidatePath("/settings/print");
    return { ok: true, data: { id: saved?.id } };
  } catch (e) {
    console.error("savePrintTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function duplicatePrintTemplate(id: string): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  if (!isPersistedTemplateId(id)) return { ok: false, error: "errors.invalidData" };

  try {
    const [source] = await db.select().from(printTemplates).where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, id))).limit(1);
    if (!source) return { ok: false, error: "errors.notFound" };
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(printTemplates).values({
        storeId: gate.storeId,
        name: `${source.name} copy`,
        docType: source.docType,
        paperDefault: source.paperDefault,
        isDefault: false,
        isActive: true,
        sortOrder: source.sortOrder + 1,
        storeName: source.storeName,
        storeAddress: source.storeAddress,
        storePhone: source.storePhone,
        storeTaxCode: source.storeTaxCode,
        footerNote: source.footerNote,
        options: source.options,
      }).returning({ id: printTemplates.id, name: printTemplates.name });
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "print.template.duplicated", entityType: "print_template", entityId: created.id,
        after: { name: created.name, isDefault: false, isActive: true },
        affectedRecords: [{ type: "print_template", id: source.id, name: source.name }],
      });
      return created;
    });
    revalidatePath("/settings/print");
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("duplicatePrintTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function setDefaultPrintTemplate(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  if (!isPersistedTemplateId(id)) return { ok: false, error: "errors.invalidData" };

  try {
    await db.transaction(async (tx) => {
      const [source] = await tx.select().from(printTemplates).where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, id))).limit(1).for("update");
      if (!source) throw new Error("not-found");
      if (source.isDefault && source.isActive) return;
      await tx.update(printTemplates).set({ isDefault: false, updatedAt: sql`now()` }).where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.docType, source.docType)));
      await tx.update(printTemplates).set({ isDefault: true, isActive: true, updatedAt: sql`now()` }).where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "print.template.default_changed", entityType: "print_template", entityId: id,
        before: { name: source.name, isDefault: source.isDefault, isActive: source.isActive },
        after: { name: source.name, isDefault: true, isActive: true },
      });
    });
    revalidatePath("/settings/print");
    return { ok: true, data: undefined };
  } catch (e) {
    if (e instanceof Error && e.message === "not-found") return { ok: false, error: "errors.notFound" };
    console.error("setDefaultPrintTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function deactivatePrintTemplate(id: string): Promise<ActionResult> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  if (!isPersistedTemplateId(id)) return { ok: false, error: "errors.invalidData" };

  try {
    const [row] = await db.select({ docType: printTemplates.docType, isDefault: printTemplates.isDefault }).from(printTemplates).where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, id))).limit(1);
    if (!row) return { ok: false, error: "errors.notFound" };
    if (row.isDefault) {
      const [replacement] = await db
        .select({ id: printTemplates.id })
        .from(printTemplates)
        .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.docType, row.docType), eq(printTemplates.isActive, true), ne(printTemplates.id, id)))
        .limit(1);
      if (!replacement) return { ok: false, error: "printSettings.errors.defaultRequired" };
    }
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(printTemplates).set({ isActive: false, isDefault: false, updatedAt: sql`now()` }).where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, id), eq(printTemplates.isActive, true))).returning({ name: printTemplates.name });
      if (!updated) return;
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "print.template.deactivated", entityType: "print_template", entityId: id,
        before: { name: updated.name, isActive: true }, after: { name: updated.name, isActive: false },
      });
    });
    revalidatePath("/settings/print");
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("deactivatePrintTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
