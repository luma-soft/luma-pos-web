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

export type ServiceProjectStage =
  | "planning"
  | "quoted"
  | "active"
  | "paused"
  | "completed"
  | "warranty"
  | "cancelled";

export type ServiceVisitStatus = "active" | "completed" | "cancelled";

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

export function canTransitionServiceVisit(
  current: ServiceVisitStatus,
  next: ServiceVisitStatus,
): boolean {
  if (current === next) return true;
  return current === "active" && (next === "completed" || next === "cancelled");
}

export function fieldCompletionErrors(input: {
  serviceType: ServiceType;
  checklist: readonly ServiceChecklistItem[];
  beforeEvidenceCount: number;
  afterEvidenceCount: number;
  signatureCount: number;
}): string[] {
  const errors: string[] = [];
  if (input.checklist.some((item) => !item.completed)) {
    errors.push("services.completion.checklistIncomplete");
  }
  if (input.beforeEvidenceCount < 1) {
    errors.push("services.completion.beforeEvidenceRequired");
  }
  if (input.afterEvidenceCount < 1) {
    errors.push("services.completion.afterEvidenceRequired");
  }
  if (input.signatureCount < 1) {
    errors.push("services.completion.signatureRequired");
  }
  return errors;
}

export function calculateServiceSlaDeadlines(input: {
  reportedAt: Date;
  responseMinutes: number;
  resolutionMinutes: number;
}) {
  if (
    Number.isNaN(input.reportedAt.getTime())
    || !Number.isInteger(input.responseMinutes)
    || !Number.isInteger(input.resolutionMinutes)
    || input.responseMinutes <= 0
    || input.resolutionMinutes < input.responseMinutes
  ) return null;
  return {
    responseDueAt: new Date(input.reportedAt.getTime() + input.responseMinutes * 60_000),
    resolutionDueAt: new Date(input.reportedAt.getTime() + input.resolutionMinutes * 60_000),
  };
}

export function deriveServiceProjectStage(input: {
  fallbackStage: ServiceProjectStage;
  jobStatuses: readonly ServiceJobStatus[];
  warrantyClaimStatuses: readonly WarrantyClaimStatus[];
}): ServiceProjectStage {
  const hasOpenWarrantyClaim = input.warrantyClaimStatuses.some(
    (status) => status !== "closed" && status !== "void",
  );
  if (hasOpenWarrantyClaim) return "warranty";

  const countableJobs = input.jobStatuses.filter((status) => status !== "cancelled");
  if (countableJobs.length > 0) {
    return countableJobs.every((status) => status === "completed")
      ? "completed"
      : "active";
  }

  return input.fallbackStage === "warranty" ? "completed" : input.fallbackStage;
}

type ProjectLink = { projectId: string | null } | null;
type OrderProjectLink = { projectId: string | null; status: string } | null;

export function validateServiceLinks({
  projectId,
  job,
  asset,
  record,
  quoteOrder,
  materialOrder,
}: {
  projectId: string;
  job?: ProjectLink;
  asset?: ProjectLink;
  record?: ProjectLink;
  quoteOrder?: OrderProjectLink;
  materialOrder?: OrderProjectLink;
}): boolean {
  if (job !== undefined && job?.projectId !== projectId) return false;
  if (asset !== undefined && asset?.projectId !== projectId) return false;
  if (record !== undefined && record?.projectId !== projectId) return false;
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

export type ServiceProjectProfitabilityInput = {
  revenue: number;
  materialCost: number;
  laborCost: number;
  otherCost: number;
};

export function calculateServiceProjectProfitability(input: ServiceProjectProfitabilityInput) {
  const values = [input.revenue, input.materialCost, input.laborCost, input.otherCost];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const totalCost = input.materialCost + input.laborCost + input.otherCost;
  const grossProfit = input.revenue - totalCost;
  return {
    revenue: input.revenue,
    materialCost: input.materialCost,
    laborCost: input.laborCost,
    otherCost: input.otherCost,
    totalCost,
    grossProfit,
    marginPercent: input.revenue > 0 ? (grossProfit / input.revenue) * 100 : 0,
  };
}
