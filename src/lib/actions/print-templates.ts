"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
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
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const saved = await db.transaction(async (tx) => {
      if (v.isDefault) {
        await tx
          .update(printTemplates)
          .set({ isDefault: false, updatedAt: sql`now()` })
          .where(eq(printTemplates.docType, v.docType));
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
          .where(eq(printTemplates.id, v.id!))
          .returning({ id: printTemplates.id });
        return row;
      }

      const [row] = await tx
        .insert(printTemplates)
        .values({
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
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  if (!isPersistedTemplateId(id)) return { ok: false, error: "errors.invalidData" };

  try {
    const [source] = await db.select().from(printTemplates).where(eq(printTemplates.id, id)).limit(1);
    if (!source) return { ok: false, error: "errors.notFound" };
    const [row] = await db.insert(printTemplates).values({
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
    }).returning({ id: printTemplates.id });
    revalidatePath("/settings/print");
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    console.error("duplicatePrintTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function setDefaultPrintTemplate(id: string): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  if (!isPersistedTemplateId(id)) return { ok: false, error: "errors.invalidData" };

  try {
    await db.transaction(async (tx) => {
      const [source] = await tx.select({ docType: printTemplates.docType }).from(printTemplates).where(eq(printTemplates.id, id)).limit(1);
      if (!source) throw new Error("not-found");
      await tx.update(printTemplates).set({ isDefault: false, updatedAt: sql`now()` }).where(eq(printTemplates.docType, source.docType));
      await tx.update(printTemplates).set({ isDefault: true, isActive: true, updatedAt: sql`now()` }).where(eq(printTemplates.id, id));
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
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  if (!isPersistedTemplateId(id)) return { ok: false, error: "errors.invalidData" };

  try {
    const [row] = await db.select({ docType: printTemplates.docType, isDefault: printTemplates.isDefault }).from(printTemplates).where(eq(printTemplates.id, id)).limit(1);
    if (!row) return { ok: false, error: "errors.notFound" };
    if (row.isDefault) {
      const [replacement] = await db
        .select({ id: printTemplates.id })
        .from(printTemplates)
        .where(and(eq(printTemplates.docType, row.docType), eq(printTemplates.isActive, true), ne(printTemplates.id, id)))
        .limit(1);
      if (!replacement) return { ok: false, error: "printSettings.errors.defaultRequired" };
    }
    await db.update(printTemplates).set({ isActive: false, isDefault: false, updatedAt: sql`now()` }).where(eq(printTemplates.id, id));
    revalidatePath("/settings/print");
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("deactivatePrintTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
