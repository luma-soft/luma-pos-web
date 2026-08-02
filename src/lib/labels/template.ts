import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { labelTemplates } from "@/db/schema";
import { BUILT_IN_LABEL_TEMPLATES, DEFAULT_LABEL_TEMPLATE, type LabelTemplate } from "./template-shared";

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
  const savedSizes = new Set(templates.map((template) => `${template.widthMm}x${template.heightMm}`));
  return [...templates, ...BUILT_IN_LABEL_TEMPLATES.filter((template) => !savedSizes.has(`${template.widthMm}x${template.heightMm}`))]
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
}

export async function getLabelTemplates(): Promise<LabelTemplate[]> {
  const rows = await db
    .select()
    .from(labelTemplates)
    .where(eq(labelTemplates.isActive, true))
    .orderBy(desc(labelTemplates.isDefault), asc(labelTemplates.sortOrder), asc(labelTemplates.name));
  return withBuiltInTemplates(rows.map(mapRow));
}

export async function getAllLabelTemplates(): Promise<LabelTemplate[]> {
  const rows = await db
    .select()
    .from(labelTemplates)
    .orderBy(desc(labelTemplates.isDefault), asc(labelTemplates.sortOrder), asc(labelTemplates.name));
  return withBuiltInTemplates(rows.map(mapRow));
}

export async function getLabelTemplate(templateId?: string | null): Promise<LabelTemplate> {
  const templates = await getLabelTemplates();
  return templates.find((template) => template.id === templateId) ?? templates[0] ?? DEFAULT_LABEL_TEMPLATE;
}
