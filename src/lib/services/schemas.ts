import { z } from "zod";

export const concreteServiceTypeSchema = z.enum([
  "camera",
  "electrical",
  "plumbing",
]);

export const serviceTypeSchema = z.enum([
  "camera",
  "electrical",
  "plumbing",
  "mixed",
]);

export const serviceProjectCreateSchema = z.object({
  name: z.string().trim().min(1),
  customerId: z.uuid().nullable().optional(),
  address: z.string().trim().optional(),
  serviceType: serviceTypeSchema,
  serviceStage: z.enum([
    "planning",
    "quoted",
    "active",
    "paused",
    "completed",
    "warranty",
    "cancelled",
  ]).default("planning"),
  startsOn: z.iso.date().nullable().optional(),
  targetEndsOn: z.iso.date().nullable().optional(),
  siteContactName: z.string().trim().optional(),
  siteContactPhone: z.string().trim().max(20).optional(),
  note: z.string().trim().optional(),
});

export type ServiceProjectCreateInput = z.input<typeof serviceProjectCreateSchema>;

export const serviceJobCreateSchema = z.object({
  projectId: z.uuid(),
  serviceType: concreteServiceTypeSchema,
  title: z.string().trim().min(1),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assignedTo: z.uuid().nullable().optional(),
  scheduledAt: z.iso.datetime().nullable().optional(),
  description: z.string().trim().optional(),
  quoteOrderId: z.uuid().nullable().optional(),
  materialOrderId: z.uuid().nullable().optional(),
});

export type ServiceJobCreateInput = z.input<typeof serviceJobCreateSchema>;

export const serviceJobUpdateSchema = serviceJobCreateSchema.omit({
  projectId: true,
  quoteOrderId: true,
  materialOrderId: true,
}).extend({
  jobId: z.uuid(),
});

export type ServiceJobUpdateInput = z.input<typeof serviceJobUpdateSchema>;

export const serviceJobTransitionSchema = z.object({
  jobId: z.uuid(),
  status: z.enum([
    "new",
    "scheduled",
    "in_progress",
    "waiting_materials",
    "waiting_customer",
    "completed",
    "warranty",
    "cancelled",
  ]),
  note: z.string().trim().optional(),
});

export type ServiceJobTransitionInput = z.input<typeof serviceJobTransitionSchema>;

export const serviceJobMaterialSchema = z.object({
  jobId: z.uuid(),
  productId: z.uuid(),
  unitName: z.string().trim().min(1).max(30),
  plannedQuantity: z.coerce.number().min(0),
  usedQuantity: z.coerce.number().min(0).default(0),
  note: z.string().trim().optional(),
});

export type ServiceJobMaterialInput = z.input<typeof serviceJobMaterialSchema>;

export const installedAssetCreateSchema = z.object({
  projectId: z.uuid(),
  jobId: z.uuid().nullable().optional(),
  productId: z.uuid().nullable().optional(),
  assetKind: z.string().trim().min(1),
  name: z.string().trim().min(1),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  serialNumber: z.string().trim().optional(),
  macAddress: z.string().trim().optional(),
  ipAddress: z.string().trim().optional(),
  locationLabel: z.string().trim().optional(),
  installedAt: z.iso.datetime({ local: true }).nullable().optional(),
  customerWarrantyEndsOn: z.iso.date().nullable().optional(),
  supplierWarrantyEndsOn: z.iso.date().nullable().optional(),
  note: z.string().trim().optional(),
});

export type InstalledAssetCreateInput = z.input<typeof installedAssetCreateSchema>;

export const installedAssetUpdateSchema = installedAssetCreateSchema.omit({
  projectId: true,
}).extend({
  assetId: z.uuid(),
  status: z.enum(["installed", "repair", "replaced", "removed"]),
});

export type InstalledAssetUpdateInput = z.input<typeof installedAssetUpdateSchema>;

export const warrantyClaimCreateSchema = z.object({
  projectId: z.uuid(),
  jobId: z.uuid().nullable().optional(),
  assetId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  scheduledAt: z.iso.datetime({ local: true }).nullable().optional(),
});

export type WarrantyClaimCreateInput = z.input<typeof warrantyClaimCreateSchema>;

export const warrantyClaimUpdateSchema = warrantyClaimCreateSchema.omit({
  projectId: true,
}).extend({
  claimId: z.uuid(),
  laborCharge: z.coerce.number().min(0).default(0),
  materialCharge: z.coerce.number().min(0).default(0),
});

export type WarrantyClaimUpdateInput = z.input<typeof warrantyClaimUpdateSchema>;

export const warrantyClaimTransitionSchema = z.object({
  claimId: z.uuid(),
  status: z.enum([
    "new",
    "scheduled",
    "in_progress",
    "waiting_materials",
    "waiting_supplier",
    "resolved",
    "closed",
    "void",
  ]),
  diagnosis: z.string().trim().optional(),
  resolution: z.string().trim().optional(),
});

export type WarrantyClaimTransitionInput = z.input<typeof warrantyClaimTransitionSchema>;
