"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { printTemplates } from "@/db/schema";
import { type ActionResult, requireManager } from "./common";

const saveSchema = z.object({
  docType: z.enum(["order", "quote", "purchase", "return", "receipt"]),
  paperDefault: z.enum(["a4", "a5", "k80"]),
  storeName: z.string().max(200).default(""),
  storeAddress: z.string().max(300).default(""),
  storePhone: z.string().max(50).default(""),
  storeTaxCode: z.string().max(30).default(""),
  footerNote: z.string().max(500).default(""),
  options: z.object({
    showSeller: z.boolean(),
    showProject: z.boolean(),
    showDebt: z.boolean(),
    showInWords: z.boolean(),
    showSignatures: z.boolean(),
    showSku: z.boolean(),
  }),
});

export type SavePrintTemplateInput = z.input<typeof saveSchema>;

export async function savePrintTemplate(input: SavePrintTemplateInput): Promise<ActionResult> {
  { const gate = await requireManager(); if (!gate.ok) return gate; }
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    await db
      .insert(printTemplates)
      .values({
        docType: v.docType,
        paperDefault: v.paperDefault,
        storeName: v.storeName,
        storeAddress: v.storeAddress,
        storePhone: v.storePhone,
        storeTaxCode: v.storeTaxCode,
        footerNote: v.footerNote,
        options: v.options,
      })
      .onConflictDoUpdate({
        target: printTemplates.docType,
        set: {
          paperDefault: v.paperDefault,
          storeName: v.storeName,
          storeAddress: v.storeAddress,
          storePhone: v.storePhone,
          storeTaxCode: v.storeTaxCode,
          footerNote: v.footerNote,
          options: v.options,
          updatedAt: sql`now()`,
        },
      });

    revalidatePath("/settings/print");
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("savePrintTemplate failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
