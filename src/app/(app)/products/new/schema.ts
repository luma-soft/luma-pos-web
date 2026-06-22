import { z } from "zod";

export const productUnitSchema = z.object({
  unitName: z.string().min(1, { error: "validation.required" }),
  multiplier: z.number().positive(),
  barcode: z.string().optional(),
  priceOverride: z.number().nullable().optional(),
});

export const productAttributeSchema = z.object({
  name: z.string().min(1, { error: "validation.required" }),
  values: z.array(z.string()).default([]),
  createsVariants: z.boolean().default(false),
});

export const productVariantChildSchema = z.object({
  variantName: z.string().min(1, { error: "validation.required" }),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  baseUnit: z.string().default("cái"),
  costPrice: z.number().min(0).default(0),
  retailPrice: z.number().min(0).default(0),
  wholesalePrice: z.number().min(0).nullable().optional(),
  contractorPrice: z.number().min(0).nullable().optional(),
  agentPrice: z.number().min(0).nullable().optional(),
  initialStock: z.number().min(0).default(0),
  minLevel: z.number().min(0).default(0),
  imageUrls: z.array(z.string()).default([]),
  directSale: z.boolean().default(true),
  specs: z.record(z.string(), z.array(z.string())).default({}),
});

export const siblingApplyFieldSchema = z.enum([
  "name",
  "imageUrls",
  "description",
  "category",
  "brand",
  "pricing",
  "units",
  "directSale",
  "attributes",
]);

export const siblingApplySchema = z.object({
  enabled: z.boolean().default(false),
  fields: z.array(siblingApplyFieldSchema).default([]),
});

export const createProductSchema = z.object({
  // Info
  sku: z.string().optional(),
  barcode: z.string().optional(),
  name: z.string().min(1, { error: "validation.required" }),
  categoryId: z.string().min(1, { error: "validation.required" }), // nhóm hàng bắt buộc
  brandId: z.string().optional(),
  supplierIds: z.array(z.string()).default([]), // nhiều NCC; phần tử đầu = NCC chính
  imageUrls: z.array(z.string()).default([]),

  // Pricing
  costPrice: z.number().min(0).default(0),
  retailPrice: z.number().min(0).default(0),
  wholesalePrice: z.number().nullable().optional(),
  contractorPrice: z.number().nullable().optional(),
  agentPrice: z.number().nullable().optional(),

  // Stock
  initialStock: z.number().min(0).default(0),
  minLevel: z.number().min(0).default(0),
  maxLevel: z.number().min(0).default(999_999_999),

  // Physical
  location: z.string().optional(),
  weight: z.number().nullable().optional(),
  weightUnit: z.enum(["g", "kg"]).default("kg"),
  width: z.number().nullable().optional(),
  length: z.number().nullable().optional(),
  thickness: z.number().nullable().optional(),
  dimUnit: z.enum(["mm", "cm", "m"]).default("mm"),

  // Units
  baseUnit: z.string().default("cái"),
  units: z.array(productUnitSchema).default([]),

  // Attributes (replaces VLXD section)
  attributes: z.array(productAttributeSchema).default([]),
  variantChildren: z.array(productVariantChildSchema).default([]),
  applyToSiblings: siblingApplySchema.default({ enabled: false, fields: [] }),

  // Description
  description: z.string().optional(),
  invoiceNote: z.string().optional(),

  directSale: z.boolean().default(true),
});

export type CreateProductInput = z.input<typeof createProductSchema>;
export type CreateProductOutput = z.output<typeof createProductSchema>;

/** Predefined attributes for VLXD industry. User can add custom too. */
export const PRESET_ATTRIBUTES = [
  "Màu sắc",
  "Kích thước",
  "Bề mặt",
  "Series",
  "Loại ống",
  "PN (Áp lực)",
  "Vật liệu",
  "Dung tích",
  "Công suất",
  "Trọng lượng",
] as const;
