export const serviceTypes = ["camera", "electrical", "plumbing", "mixed"] as const;

export type ServiceType = (typeof serviceTypes)[number];
export type ConcreteServiceType = Exclude<ServiceType, "mixed">;

export type ServiceChecklistItem = {
  code: string;
  labelKey: string;
  completed: boolean;
};

export const serviceJobStatuses = [
  "new",
  "scheduled",
  "in_progress",
  "waiting_materials",
  "waiting_customer",
  "completed",
  "warranty",
  "cancelled",
] as const;

export type ServiceJobStatus = (typeof serviceJobStatuses)[number];

export const warrantyClaimStatuses = [
  "new",
  "scheduled",
  "in_progress",
  "waiting_materials",
  "waiting_supplier",
  "resolved",
  "closed",
  "void",
] as const;

export type WarrantyClaimStatus = (typeof warrantyClaimStatuses)[number];

const allowedStatusTransitions: Record<ServiceJobStatus, readonly ServiceJobStatus[]> = {
  new: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["in_progress", "waiting_materials", "waiting_customer", "cancelled"],
  in_progress: ["waiting_materials", "waiting_customer", "completed", "cancelled"],
  waiting_materials: ["scheduled", "in_progress", "cancelled"],
  waiting_customer: ["scheduled", "in_progress", "cancelled"],
  completed: ["warranty"],
  warranty: ["in_progress", "completed"],
  cancelled: [],
};

const allowedWarrantyTransitions: Record<WarrantyClaimStatus, readonly WarrantyClaimStatus[]> = {
  new: ["scheduled", "in_progress", "void"],
  scheduled: ["in_progress", "waiting_materials", "waiting_supplier", "void"],
  in_progress: ["waiting_materials", "waiting_supplier", "resolved", "void"],
  waiting_materials: ["in_progress", "resolved", "void"],
  waiting_supplier: ["in_progress", "resolved", "void"],
  resolved: ["closed", "in_progress"],
  closed: [],
  void: [],
};

const defaultChecklistCodes: Record<ServiceType, readonly string[]> = {
  camera: [
    "site-survey",
    "cabling",
    "device-installation",
    "configuration",
    "commissioning",
    "handover",
  ],
  electrical: [
    "electrical-survey",
    "isolation",
    "cabling-and-panel",
    "fixture-installation",
    "electrical-testing",
    "handover",
  ],
  plumbing: [
    "plumbing-survey",
    "water-isolation",
    "pipework",
    "fixture-installation",
    "pressure-and-leak-test",
    "handover",
  ],
  mixed: [],
};

export function createDefaultChecklist(type: ServiceType): ServiceChecklistItem[] {
  return defaultChecklistCodes[type].map((code) => ({
    code,
    labelKey: `services.checklist.${code}`,
    completed: false,
  }));
}

export function isServiceTypeAllowedForProject(
  projectType: ServiceType,
  jobType: ConcreteServiceType,
): boolean {
  return projectType === "mixed" || projectType === jobType;
}

export function canTransitionServiceJob(
  current: ServiceJobStatus,
  next: ServiceJobStatus,
): boolean {
  return current === next || allowedStatusTransitions[current].includes(next);
}

export function canTransitionWarrantyClaim(
  current: WarrantyClaimStatus,
  next: WarrantyClaimStatus,
): boolean {
  return current === next || allowedWarrantyTransitions[current].includes(next);
}

type ProjectLink = { projectId: string | null } | null;
type OrderProjectLink = { projectId: string | null; status: string } | null;

export function validateServiceLinks({
  projectId,
  job,
  asset,
  quoteOrder,
  materialOrder,
}: {
  projectId: string;
  job?: ProjectLink;
  asset?: ProjectLink;
  quoteOrder?: OrderProjectLink;
  materialOrder?: OrderProjectLink;
}): boolean {
  if (job !== undefined && job?.projectId !== projectId) return false;
  if (asset !== undefined && asset?.projectId !== projectId) return false;
  if (quoteOrder !== undefined && (quoteOrder?.projectId !== projectId || quoteOrder.status !== "quote")) return false;
  if (materialOrder !== undefined && (
    materialOrder?.projectId !== projectId
    || materialOrder.status === "quote"
    || materialOrder.status === "cancelled"
  )) return false;
  return true;
}

export function calculateServiceMaterialStockSync(
  usedQuantity: number,
  unitMultiplier: number,
  issuedBaseQuantity: number,
) {
  if (
    !Number.isFinite(usedQuantity)
    || !Number.isFinite(unitMultiplier)
    || !Number.isFinite(issuedBaseQuantity)
    || usedQuantity < 0
    || unitMultiplier <= 0
    || issuedBaseQuantity < 0
  ) return null;
  const targetBaseQuantity = Math.round(usedQuantity * unitMultiplier * 10_000) / 10_000;
  const deltaBaseQuantity = Math.round((targetBaseQuantity - issuedBaseQuantity) * 10_000) / 10_000;
  return { targetBaseQuantity, deltaBaseQuantity };
}
