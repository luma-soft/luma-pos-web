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

const serviceInstallationItemSchema = z.object({
  clientDraftId: z.string().trim().min(1).max(80),
  productId: z.uuid(),
  unitName: z.string().trim().min(1).max(30),
  quantity: z.coerce.number().positive().max(999999),
  tracking: z.enum(["consumable", "asset"]),
  serialNumbers: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  assetKind: z.string().trim().max(100).optional(),
  name: z.string().trim().max(300).optional(),
  model: z.string().trim().max(200).optional(),
});

export const serviceInstallationBatchSchema = z.object({
  projectId: z.uuid(),
  jobId: z.uuid(),
  requestId: z.string().trim().min(8).max(100),
  stockMode: z.enum(["plan", "reserve", "issue"]).default("plan"),
  warehouseId: z.uuid().nullable().optional(),
  invoiceMode: z.enum(["none", "link", "create"]).default("none"),
  materialOrderId: z.uuid().nullable().optional(),
  locationLabel: z.string().trim().max(300).optional(),
  installedAt: z.iso.datetime({ local: true }).nullable().optional(),
  note: z.string().trim().max(2000).optional(),
  items: z.array(serviceInstallationItemSchema).min(1).max(50),
}).superRefine((value, context) => {
  if (value.stockMode !== "plan" && !value.warehouseId) {
    context.addIssue({
      code: "custom",
      message: "warehouseId is required when reserving or issuing stock",
      path: ["warehouseId"],
    });
  }
  if (value.invoiceMode === "link" && !value.materialOrderId) {
    context.addIssue({
      code: "custom",
      message: "materialOrderId is required when linking an invoice",
      path: ["materialOrderId"],
    });
  }
  if (value.invoiceMode !== "link" && value.materialOrderId) {
    context.addIssue({
      code: "custom",
      message: "materialOrderId is only valid when linking an invoice",
      path: ["materialOrderId"],
    });
  }
  if (value.invoiceMode !== "none" && value.stockMode !== "plan") {
    context.addIssue({
      code: "custom",
      message: "invoice-backed installation items must let the invoice own stock",
      path: ["stockMode"],
    });
  }

  const keys = new Set<string>();
  let assetCount = 0;
  value.items.forEach((item, index) => {
    const key = `${item.productId}:${item.unitName.toLocaleLowerCase("vi")}`;
    if (keys.has(key)) {
      context.addIssue({
        code: "custom",
        message: "product and unit must be unique within a batch",
        path: ["items", index, "productId"],
      });
    }
    keys.add(key);
    if (item.tracking === "asset") {
      if (!Number.isInteger(item.quantity)) {
        context.addIssue({
          code: "custom",
          message: "tracked asset quantity must be an integer",
          path: ["items", index, "quantity"],
        });
      }
      assetCount += item.quantity;
      if (item.serialNumbers.length > item.quantity) {
        context.addIssue({
          code: "custom",
          message: "serial count cannot exceed asset quantity",
          path: ["items", index, "serialNumbers"],
        });
      }
    } else if (item.serialNumbers.length > 0) {
      context.addIssue({
        code: "custom",
        message: "consumable items cannot have serial numbers",
        path: ["items", index, "serialNumbers"],
      });
    }
  });
  if (assetCount > 50) {
    context.addIssue({
      code: "custom",
      message: "a batch can create at most 50 tracked assets",
      path: ["items"],
    });
  }
});

export type ServiceInstallationBatchInput = z.input<typeof serviceInstallationBatchSchema>;
export type ServiceInstallationBatch = z.output<typeof serviceInstallationBatchSchema>;

export const serviceMaterialStockSyncSchema = z.object({
  materialId: z.uuid(),
  warehouseId: z.uuid(),
});

export type ServiceMaterialStockSyncInput = z.input<typeof serviceMaterialStockSyncSchema>;

export const serviceCostEntrySchema = z.object({
  id: z.uuid().nullable().optional(),
  projectId: z.uuid(),
  jobId: z.uuid().nullable().optional(),
  type: z.enum(["labor", "subcontractor", "transport", "other"]),
  description: z.string().trim().min(1),
  quantity: z.coerce.number().min(0),
  unitCost: z.coerce.number().min(0),
  staffId: z.uuid().nullable().optional(),
  incurredOn: z.iso.date(),
  note: z.string().trim().optional(),
});

export type ServiceCostEntryInput = z.input<typeof serviceCostEntrySchema>;

export const serviceMaterialReservationSchema = z.object({
  materialId: z.uuid(),
  warehouseId: z.uuid(),
  quantity: z.coerce.number().positive(),
});

export type ServiceMaterialReservationInput = z.input<typeof serviceMaterialReservationSchema>;

export const serviceHandoverDocumentSchema = z.object({
  id: z.uuid().nullable().optional(),
  projectId: z.uuid(),
  jobId: z.uuid().nullable().optional(),
  type: z.enum(["survey", "acceptance", "handover"]),
  title: z.string().trim().min(1),
  content: z.string().trim().optional(),
  photoUrls: z.array(z.string().trim().url()).max(30).default([]),
  signedBy: z.string().trim().optional(),
  signedAt: z.iso.date().nullable().optional(),
  status: z.enum(["draft", "signed"]).default("draft"),
});

export type ServiceHandoverDocumentInput = z.input<typeof serviceHandoverDocumentSchema>;

export const serviceMaintenancePlanSchema = z.object({
  id: z.uuid().nullable().optional(),
  projectId: z.uuid(),
  assetId: z.uuid().nullable().optional(),
  serviceType: concreteServiceTypeSchema,
  title: z.string().trim().min(1),
  intervalDays: z.coerce.number().int().positive(),
  nextDueOn: z.iso.date(),
  assignedTo: z.uuid().nullable().optional(),
  isActive: z.boolean().default(true),
  note: z.string().trim().optional(),
});

export type ServiceMaintenancePlanInput = z.input<typeof serviceMaintenancePlanSchema>;

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

export const INSTALLED_ASSET_CLIENT_DRAFT_ID_MAX_LENGTH = 80;

export function createInstalledAssetCatalogDraftId(randomId = crypto.randomUUID()) {
  return `product-${randomId}`;
}

const installedAssetBatchDraftSchema = installedAssetCreateSchema.omit({
  projectId: true,
}).extend({
  clientDraftId: z.string().trim().min(1).max(INSTALLED_ASSET_CLIENT_DRAFT_ID_MAX_LENGTH),
});

export const installedAssetBatchCreateSchema = z.object({
  projectId: z.uuid(),
  requestId: z.string().trim().min(8).max(100),
  assets: z.array(installedAssetBatchDraftSchema).min(1).max(50),
}).superRefine(({ assets }, context) => {
  const draftIds = new Set<string>();
  assets.forEach((asset, index) => {
    if (draftIds.has(asset.clientDraftId)) {
      context.addIssue({
        code: "custom",
        message: "clientDraftId must be unique within a batch",
        path: ["assets", index, "clientDraftId"],
      });
    }
    draftIds.add(asset.clientDraftId);
  });
});

export type InstalledAssetBatchCreateInput = z.input<typeof installedAssetBatchCreateSchema>;

export type InstalledAssetBatchValidationIssue =
  | {
    scope: "common";
    field: "locationLabel" | "installedOn";
    fieldLabel: string;
  }
  | {
    scope: "asset";
    clientDraftId: string;
    draftIndex: number;
    field: "name" | "assetKind";
    fieldLabel: string;
  };

export function validateInstalledAssetBatchDrafts(value: {
  locationLabel: string;
  installedOn: string;
  assets: Array<{
    clientDraftId: string;
    name: string;
    assetKind: string;
  }>;
}): {
  valid: boolean;
  issues: InstalledAssetBatchValidationIssue[];
  message: string;
} {
  const issues: InstalledAssetBatchValidationIssue[] = [];
  if (!value.locationLabel.trim()) {
    issues.push({
      scope: "common",
      field: "locationLabel",
      fieldLabel: "Vị trí lắp đặt",
    });
  }
  if (!value.installedOn.trim()) {
    issues.push({
      scope: "common",
      field: "installedOn",
      fieldLabel: "Ngày lắp đặt",
    });
  }
  value.assets.forEach((asset, draftIndex) => {
    if (!asset.name.trim()) {
      issues.push({
        scope: "asset",
        clientDraftId: asset.clientDraftId,
        draftIndex,
        field: "name",
        fieldLabel: "Tên thiết bị",
      });
    }
    if (!asset.assetKind.trim()) {
      issues.push({
        scope: "asset",
        clientDraftId: asset.clientDraftId,
        draftIndex,
        field: "assetKind",
        fieldLabel: "Loại thiết bị",
      });
    }
  });

  const messageParts: string[] = [];
  const commonLabels = issues
    .filter((issue) => issue.scope === "common")
    .map((issue) => issue.fieldLabel);
  if (commonLabels.length) {
    messageParts.push(`Thông tin áp dụng chung: thiếu ${commonLabels.join(", ")}.`);
  }
  value.assets.forEach((asset, draftIndex) => {
    const labels = issues
      .filter((issue) => issue.scope === "asset" && issue.clientDraftId === asset.clientDraftId)
      .map((issue) => issue.fieldLabel);
    if (labels.length) {
      messageParts.push(`Thiết bị ${draftIndex + 1}: thiếu ${labels.join(", ")}.`);
    }
  });

  return {
    valid: issues.length === 0,
    issues,
    message: messageParts.join(" "),
  };
}

export function isInstalledAssetBatchDraftReady(value: {
  clientDraftId: string;
  locationLabel: string;
  installedOn: string;
  name: string;
  assetKind: string;
}) {
  return validateInstalledAssetBatchDrafts({
    locationLabel: value.locationLabel,
    installedOn: value.installedOn,
    assets: [{
      clientDraftId: value.clientDraftId,
      name: value.name,
      assetKind: value.assetKind,
    }],
  }).valid;
}

export function installedAssetCatalogFeedback(
  status: "loading" | "cached" | "synced" | "unavailable",
  productCount: number,
): {
  state: "loading" | "error" | "empty" | "ready";
  message: string;
  retryable: boolean;
} {
  if (productCount > 0) {
    return { state: "ready", message: "", retryable: false };
  }
  if (status === "loading") {
    return {
      state: "loading",
      message: "Đang tải danh mục sản phẩm…",
      retryable: false,
    };
  }
  if (status === "unavailable") {
    return {
      state: "error",
      message: "Không thể tải danh mục sản phẩm.",
      retryable: true,
    };
  }
  return {
    state: "empty",
    message: "Không tìm thấy sản phẩm phù hợp.",
    retryable: false,
  };
}

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

export const technicianWarrantyClaimCreateSchema = z.object({
  jobId: z.uuid(),
  assetId: z.uuid(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4_000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  scheduledAt: z.iso.datetime({ local: true }).nullable().optional(),
}).strict();

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

const clientMutationIdSchema = z.string().trim().min(8).max(100);
const expectedVersionSchema = z.number().int().positive();

export const serviceJobAssignmentSchema = z.object({
  jobId: z.uuid(),
  profileId: z.uuid(),
  assignmentRole: z.enum(["primary", "crew"]).default("crew"),
});

export const serviceVisitMutationSchema = z.object({
  jobId: z.uuid(),
  clientMutationId: clientMutationIdSchema,
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  note: z.string().trim().max(1000).optional(),
});

export const serviceChecklistUpdateSchema = z.object({
  jobId: z.uuid(),
  clientMutationId: clientMutationIdSchema,
  expectedVersion: expectedVersionSchema,
  checklist: z.array(z.object({
    code: z.string().trim().min(1).max(80),
    labelKey: z.string().trim().min(1).max(160),
    completed: z.boolean(),
  })).min(1).max(100),
});

export const serviceAttachmentMetadataSchema = z.object({
  jobId: z.uuid(),
  category: z.enum(["before", "after", "issue", "document", "signature"]),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  sizeBytes: z.coerce.number().int().positive().max(15 * 1024 * 1024),
  caption: z.string().trim().max(500).optional(),
});

export const serviceAssetAttachmentMetadataSchema = z.object({
  assetId: z.uuid(),
  category: z.literal("asset"),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ]),
  sizeBytes: z.coerce.number().int().positive().max(15 * 1024 * 1024),
  clientRequestId: z.string().trim().min(8).max(200),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
  isPrimary: z.boolean().default(false),
  caption: z.string().trim().max(500).optional(),
});

export const serviceSignatureSchema = z.object({
  jobId: z.uuid(),
  attachmentId: z.uuid(),
  signerName: z.string().trim().min(1).max(200),
  signerRole: z.string().trim().max(100).optional(),
  clientMutationId: clientMutationIdSchema,
});

export const serviceCompletionSchema = z.object({
  jobId: z.uuid(),
  clientMutationId: clientMutationIdSchema,
  completionNote: z.string().trim().min(1).max(4000),
});

export const serviceFieldAssetCreateSchema = installedAssetCreateSchema.omit({
  projectId: true,
  jobId: true,
}).extend({
  jobId: z.uuid(),
  clientMutationId: clientMutationIdSchema,
  expectedVersion: expectedVersionSchema,
});

export const serviceFieldMaterialUsageSchema = z.object({
  jobId: z.uuid(),
  materialId: z.uuid(),
  usedQuantity: z.coerce.number().min(0),
  note: z.string().trim().max(1000).optional(),
  clientMutationId: clientMutationIdSchema,
  expectedVersion: expectedVersionSchema,
});

export const serviceCustomerRequestLinkSchema = z.object({
  projectId: z.uuid(),
  customerId: z.uuid().nullable().optional(),
  assetId: z.uuid().nullable().optional(),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});

export const serviceCustomerRequestSubmitSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(5000),
  contactName: z.string().trim().min(1).max(200),
  contactPhone: z.string().trim().min(8).max(20),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const serviceCustomerRequestManageSchema = z.object({
  status: z.enum(["new", "triaged", "scheduled", "in_progress", "resolved", "closed", "void"]).optional(),
  linkedJobId: z.uuid().nullable().optional(),
  internalNote: z.string().trim().max(5000).nullable().optional(),
});

export type ServiceJobAssignmentInput = z.input<typeof serviceJobAssignmentSchema>;
export type ServiceVisitMutationInput = z.input<typeof serviceVisitMutationSchema>;
export type ServiceChecklistUpdateInput = z.input<typeof serviceChecklistUpdateSchema>;
export type ServiceAttachmentMetadataInput = z.input<typeof serviceAttachmentMetadataSchema>;
export type ServiceAssetAttachmentMetadataInput = z.input<typeof serviceAssetAttachmentMetadataSchema>;
export type ServiceSignatureInput = z.input<typeof serviceSignatureSchema>;
export type ServiceCompletionInput = z.input<typeof serviceCompletionSchema>;
export type ServiceFieldAssetCreateInput = z.input<typeof serviceFieldAssetCreateSchema>;
export type ServiceFieldMaterialUsageInput = z.input<typeof serviceFieldMaterialUsageSchema>;
export type ServiceCustomerRequestLinkInput = z.input<typeof serviceCustomerRequestLinkSchema>;
export type ServiceCustomerRequestSubmitInput = z.input<typeof serviceCustomerRequestSubmitSchema>;
