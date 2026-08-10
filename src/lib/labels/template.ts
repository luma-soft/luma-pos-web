import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { labelTemplates } from "@/db/schema";
import { BUILT_IN_LABEL_TEMPLATES, DEFAULT_LABEL_TEMPLATE, type LabelTemplate } from "./template-shared";

const RETIRED_LEGACY_TEMPLATE_NAMES = new Set([
  "Tem 40x30mm",
  "Tem 40x20mm",
  "Tem 50x30mm",
  "Tem 50x25mm",
  "Tem nhỏ 35x22mm",
  "Tem 60x40mm",
  "Tem 100x50mm",
]);

const RETIRED_LEGACY_TEMPLATE_IDS = new Set([
  "default-label-40x30",
  "default-label-40x20",
  "default-label-50x25",
  "default-label-35x22",
  "default-label-60x40",
  "default-label-100x50",
]);

function mapRow(row: typeof labelTemplates.$inferSelect): LabelTemplate {
  return {
    id: row.id,
    name: row.name,
    widthMm: Number(row.widthMm),
    heightMm: Number(row.heightMm),
    columns: row.columns,
    gapMm: Number(row.gapMm),
    barcodeType: row.barcodeType === "code128" ? "code128" : "code128",
    showName: row.showName,
    showSku: row.showSku,
    showPrice: row.showPrice,
    showUnit: row.showUnit,
    showBarcodeText: row.showBarcodeText,
    showStoreName: row.showStoreName,
    barcodeHeightMm: Number(row.barcodeHeightMm),
    barcodeQuietMm: Number(row.barcodeQuietMm),
    fontScale: Number(row.fontScale),
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function withBuiltInTemplates(templates: LabelTemplate[]) {
  const visibleTemplates = templates.filter((template) => !RETIRED_LEGACY_TEMPLATE_NAMES.has(template.name) && !RETIRED_LEGACY_TEMPLATE_IDS.has(template.id));
  const savedLayouts = new Set(visibleTemplates.map((template) => `${template.widthMm}x${template.heightMm}x${template.columns}`));
  return [...visibleTemplates, ...BUILT_IN_LABEL_TEMPLATES.filter((template) => !savedLayouts.has(`${template.widthMm}x${template.heightMm}x${template.columns}`))]
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
}

export async function getLabelTemplates(storeId: string): Promise<LabelTemplate[]> {
  const rows = await db
    .select()
    .from(labelTemplates)
    .where(and(eq(labelTemplates.storeId, storeId), eq(labelTemplates.isActive, true)))
    .orderBy(desc(labelTemplates.isDefault), asc(labelTemplates.sortOrder), asc(labelTemplates.name));
  return withBuiltInTemplates(rows.map(mapRow));
}

export async function getAllLabelTemplates(storeId: string): Promise<LabelTemplate[]> {
  const rows = await db
    .select()
    .from(labelTemplates)
    .where(eq(labelTemplates.storeId, storeId))
    .orderBy(desc(labelTemplates.isDefault), asc(labelTemplates.sortOrder), asc(labelTemplates.name));
  return withBuiltInTemplates(rows.map(mapRow));
}

export async function getLabelTemplate(storeId: string, templateId?: string | null): Promise<LabelTemplate> {
  const templates = await getLabelTemplates(storeId);
  return templates.find((template) => template.id === templateId) ?? templates[0] ?? DEFAULT_LABEL_TEMPLATE;
}
