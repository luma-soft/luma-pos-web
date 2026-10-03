"use server";

import { isDeepStrictEqual } from "node:util";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { recordActivity } from "@/lib/audit/activity-log";
import { printTemplates } from "@/db/schema";
import { type ActionResult, requireManager } from "./common";
import { isPersistedTemplateId, normalizeLineDiscountOptions, normalizeSignatureOptions, defaultOptionsForDocType, typographyForPaper, type PrintTemplateOptions } from "@/lib/print/template-shared";
import { sanitizePrintRichText } from "@/lib/print/rich-text";

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
  footerNote: z.string().max(10_000).default("").transform(sanitizePrintRichText),
  options: z.object({
    typography: z.object({
      storeName: z.number().int().min(8).max(40),
      storeInfo: z.number().int().min(8).max(40),
      documentTitle: z.number().int().min(8).max(40),
      documentMeta: z.number().int().min(8).max(40),
      customer: z.number().int().min(8).max(40),
      tableHeader: z.number().int().min(8).max(40),
      productName: z.number().int().min(8).max(40),
      productMeta: z.number().int().min(8).max(40),
      numbers: z.number().int().min(8).max(40),
      lineTotal: z.number().int().min(8).max(40),
      grandTotal: z.number().int().min(8).max(40),
      inWords: z.number().int().min(8).max(40),
      paymentInfo: z.number().int().min(8).max(40),
      qrInfo: z.number().int().min(8).max(40),
      signatures: z.number().int().min(8).max(40),
      footer: z.number().int().min(8).max(40),
    }).partial().default({}),
    paymentQrSize: z.number().int().min(64).max(320).default(112),
    showSeller: z.boolean(),
    showProject: z.boolean(),
    showPartyPhone: z.boolean().default(true),
    showDeliveryAddress: z.boolean().default(true),
    showDebt: z.boolean(),
    showBatchDebtSummary: z.boolean().default(true),
    showDiscount: z.boolean(),
    showTax: z.boolean(),
    showLineDiscount: z.boolean(),
    showLineDiscountPercent: z.boolean().default(true),
    showLineDiscountAmount: z.boolean().default(true),
    showPaymentQr: z.boolean(),
    alwaysShowPaymentQr: z.boolean().default(false),
    showInWords: z.boolean(),
    showSignatures: z.boolean(),
    showSignatureLeft: z.boolean().default(true),
    showSignatureMiddle: z.boolean().default(true),
    showSignatureRight: z.boolean().default(true),
    showSku: z.boolean(),
    taxLabel: z.string().trim().max(80).default(""),
    signatureLeftLabel: z.string().trim().max(80).default(""),
    signatureMiddleLabel: z.string().trim().max(80).default(""),
    signatureRightLabel: z.string().trim().max(80).default(""),
    paymentQrTitle: z.string().trim().max(100).default(""),
    paymentQrContentTemplate: z.string().trim().max(100).default("{invoiceCode}"),
    paymentQrAccountSource: z.enum(["default", "custom"]).default("default"),
    paymentQrCustomBankCode: z.string().trim().max(40).default(""),
    paymentQrCustomBankName: z.string().trim().max(100).default(""),
    paymentQrCustomAccountNumber: z.string().trim().max(50).default(""),
    paymentQrCustomAccountName: z.string().trim().max(160).default(""),
    showPaymentQrBank: z.boolean().default(true),
    showPaymentQrAccountNumber: z.boolean().default(true),
    showPaymentQrAccountName: z.boolean().default(true),
    showPaymentQrReference: z.boolean().default(true),
  }).superRefine((options, ctx) => {
    if (!options.showPaymentQr || options.paymentQrAccountSource !== "custom") return;
    if (!options.paymentQrCustomBankCode) ctx.addIssue({ code: "custom", path: ["paymentQrCustomBankCode"], message: "Bank is required" });
    if (!options.paymentQrCustomAccountNumber) ctx.addIssue({ code: "custom", path: ["paymentQrCustomAccountNumber"], message: "Account number is required" });
  }),
});

export type SavePrintTemplateInput = z.input<typeof saveSchema>;

export async function savePrintTemplate(input: SavePrintTemplateInput): Promise<ActionResult<{ id?: string }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = {
    ...parsed.data,
    options: normalizeSignatureOptions(normalizeLineDiscountOptions({
      ...defaultOptionsForDocType(parsed.data.docType),
      ...parsed.data.options,
      typography: typographyForPaper(parsed.data.paperDefault, parsed.data.options.typography),
    } as PrintTemplateOptions)),
  };

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
            options: v.options as unknown as Record<string, boolean | string | number | Record<string, number>>,
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
          options: v.options as unknown as Record<string, boolean | string | number | Record<string, number>>,
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

export async function deletePrintTemplate(id: string): Promise<ActionResult<{ defaultId: string | null }>> {
  const gate = await requireManager(); if (!gate.ok) return gate;
  if (!isPersistedTemplateId(id)) return { ok: false, error: "errors.invalidData" };

  try {
    const defaultId = await db.transaction(async (tx) => {
      const [source] = await tx.select().from(printTemplates)
        .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, id)))
        .limit(1).for("update");
      if (!source) throw new Error("TEMPLATE_NOT_FOUND");
      if (source.isDefault) throw new Error("TEMPLATE_DEFAULT_CANNOT_DELETE");

      const [deleted] = await tx.delete(printTemplates)
        .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, id)))
        .returning({ name: printTemplates.name, docType: printTemplates.docType });
      if (!deleted) throw new Error("TEMPLATE_NOT_FOUND");
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "print.template.deleted", entityType: "print_template", entityId: id,
        before: { name: deleted.name, docType: deleted.docType },
      });

      const activeTemplates = await tx.select({
        id: printTemplates.id,
        name: printTemplates.name,
        isDefault: printTemplates.isDefault,
        isActive: printTemplates.isActive,
      }).from(printTemplates)
        .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.docType, deleted.docType), eq(printTemplates.isActive, true)))
        .orderBy(desc(printTemplates.isDefault), asc(printTemplates.sortOrder), asc(printTemplates.name))
        .for("update");
      const currentDefault = activeTemplates.find((template) => template.isDefault);
      if (currentDefault) return currentDefault.id;

      const remainingTemplates = activeTemplates.length > 0 ? activeTemplates : await tx.select({
        id: printTemplates.id,
        name: printTemplates.name,
        isDefault: printTemplates.isDefault,
        isActive: printTemplates.isActive,
      }).from(printTemplates)
        .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.docType, deleted.docType)))
        .orderBy(asc(printTemplates.sortOrder), asc(printTemplates.name))
        .for("update");
      const replacement = remainingTemplates[0];
      if (!replacement) return null;

      await tx.update(printTemplates)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.docType, deleted.docType)));
      await tx.update(printTemplates)
        .set({ isDefault: true, isActive: true, updatedAt: sql`now()` })
        .where(and(eq(printTemplates.storeId, gate.storeId), eq(printTemplates.id, replacement.id)));
      await recordActivity(tx, {
        storeId: gate.storeId, actorId: gate.userId, action: "print.template.default_changed", entityType: "print_template", entityId: replacement.id,
        before: { name: replacement.name, isDefault: replacement.isDefault, isActive: replacement.isActive },
        after: { name: replacement.name, isDefault: true, isActive: true },
        metadata: { reason: "replacement_after_template_delete" },
      });
      return replacement.id;
    });
    revalidatePath("/settings/print");
    return { ok: true, data: { defaultId } };
  } catch (e) {
    if (e instanceof Error && e.message === "TEMPLATE_NOT_FOUND") return { ok: false, error: "errors.notFound" };
    if (e instanceof Error && e.message === "TEMPLATE_DEFAULT_CANNOT_DELETE") return { ok: false, error: "printSettings.errors.cannotDeleteDefault" };
    console.error("deletePrintTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
