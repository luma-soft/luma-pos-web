import { db } from "@/db";
import { printTemplates } from "@/db/schema";
import { getStoreSettings } from "@/lib/data/settings";
import { and, asc, desc, eq } from "drizzle-orm";
import { cache } from "react";
import {
  DEFAULT_OPTIONS, PRINT_DOC_TYPES, defaultTemplate,
  type PrintDocType, type PrintTemplate, type PrintTemplateOptions, type PrintTemplateStoreInfo,
} from "./template-shared";

// Re-export phần dùng chung để các import cũ (@/lib/print/template) không phải đổi.
export {
  DEFAULT_OPTIONS, PAPER_SIZES, PRINT_DOC_TYPES, defaultTemplate, isPersistedTemplateId, moneyToWords,
} from "./template-shared";
export type { PrintDocType, PaperSize, PrintTemplate, PrintTemplateOptions } from "./template-shared";

function mapTemplateRow(row: typeof printTemplates.$inferSelect): PrintTemplate {
  return {
    id: row.id,
    name: row.name,
    docType: row.docType,
    paperDefault: row.paperDefault,
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    storeName: row.storeName,
    storeAddress: row.storeAddress,
    storePhone: row.storePhone,
    storeTaxCode: row.storeTaxCode,
    footerNote: row.footerNote,
    options: { ...DEFAULT_OPTIONS, ...(row.options as Partial<PrintTemplateOptions>) },
  };
}

const getCurrentStoreInfo = cache(async (storeId: string): Promise<PrintTemplateStoreInfo> => {
  const store = await getStoreSettings(storeId);
  return {
    storeName: store.name,
    storeAddress: store.address,
    storePhone: store.phone,
    storeTaxCode: store.taxCode,
  };
});

export async function getPrintTemplateStoreInfo(storeId: string): Promise<PrintTemplateStoreInfo> {
  return getCurrentStoreInfo(storeId);
}

function withStoreDefaults(template: PrintTemplate, store: PrintTemplateStoreInfo): PrintTemplate {
  return {
    ...template,
    storeName: template.storeName.trim() || store.storeName,
    storeAddress: template.storeAddress.trim() || store.storeAddress,
    storePhone: template.storePhone.trim() || store.storePhone,
    storeTaxCode: template.storeTaxCode.trim() || store.storeTaxCode,
  };
}

export async function getPrintTemplate(storeId: string, docType: PrintDocType, templateId?: string | null): Promise<PrintTemplate> {
  const store = await getCurrentStoreInfo(storeId);
  if (templateId && !templateId.startsWith("default-")) {
    const [selected] = await db
      .select()
      .from(printTemplates)
      .where(and(eq(printTemplates.storeId, storeId), eq(printTemplates.id, templateId), eq(printTemplates.docType, docType), eq(printTemplates.isActive, true)))
      .limit(1);
    if (selected) return withStoreDefaults(mapTemplateRow(selected), store);
  }

  const [row] = await db
    .select()
    .from(printTemplates)
    .where(and(eq(printTemplates.storeId, storeId), eq(printTemplates.docType, docType), eq(printTemplates.isActive, true)))
    .orderBy(desc(printTemplates.isDefault), asc(printTemplates.sortOrder), asc(printTemplates.name))
    .limit(1);
  return row ? withStoreDefaults(mapTemplateRow(row), store) : defaultTemplate(docType, store);
}

export async function getPrintTemplatesForDoc(storeId: string, docType: PrintDocType): Promise<PrintTemplate[]> {
  const store = await getCurrentStoreInfo(storeId);
  const rows = await db
    .select()
    .from(printTemplates)
    .where(and(eq(printTemplates.storeId, storeId), eq(printTemplates.docType, docType), eq(printTemplates.isActive, true)))
    .orderBy(desc(printTemplates.isDefault), asc(printTemplates.sortOrder), asc(printTemplates.name));
  return rows.length > 0 ? rows.map((row) => withStoreDefaults(mapTemplateRow(row), store)) : [defaultTemplate(docType, store)];
}

export async function getAllPrintTemplates(storeId: string): Promise<PrintTemplate[]> {
  const store = await getCurrentStoreInfo(storeId);
  const rows = await db
    .select()
    .from(printTemplates)
    .where(eq(printTemplates.storeId, storeId))
    .orderBy(asc(printTemplates.docType), desc(printTemplates.isDefault), asc(printTemplates.sortOrder), asc(printTemplates.name));
  const templates = rows.map((row) => withStoreDefaults(mapTemplateRow(row), store));
  const hasDocType = new Set(templates.map((template) => template.docType));
  for (const docType of PRINT_DOC_TYPES) {
    if (!hasDocType.has(docType)) templates.push(defaultTemplate(docType, store));
  }
  return templates;
}
