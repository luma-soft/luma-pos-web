import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import {
  installedAssets, products, projects, profiles, customers, serviceCostEntries, serviceHandoverDocuments,
  serviceJobMaterials, serviceJobs, serviceMaintenancePlans, warrantyClaims,
} from "@/db/schema";
import { recordActivity, type ActivityDatabase } from "@/lib/audit/activity-log";

const tables = {
  project: projects,
  service_project: projects,
  service_job: serviceJobs,
  service_material: serviceJobMaterials,
  installed_asset: installedAssets,
  warranty_claim: warrantyClaims,
  service_handover_document: serviceHandoverDocuments,
  service_maintenance_plan: serviceMaintenancePlans,
  service_cost_entry: serviceCostEntries,
};
type ServiceEntity = keyof typeof tables;
type Actor = { storeId: string; userId: string };

// Explicit business fields only: never copy camera credentials, network addresses,
// signatures, attachment URLs, or customer contact details into the activity feed.
const snapshotFields = [
  "code", "name", "title", "description", "note", "assignedTo", "quoteOrderId", "materialOrderId", "projectId", "jobId", "productId", "assetKind", "brand", "model",
  "status", "priority", "serviceType", "serviceStage", "progressPercent", "scheduledAt",
  "startsOn", "targetEndsOn", "unitName", "plannedQuantity", "usedQuantity", "quantity",
  "unitCost", "amount", "type", "intervalDays", "nextDueOn", "isActive", "laborCharge",
  "materialCharge", "incurredOn", "locationLabel", "installedAt", "serialNumber", "signedAt", "signedBy", "customerWarrantyEndsOn", "supplierWarrantyEndsOn",
] as const;

async function serviceActivityState(
  database: ActivityDatabase, storeId: string, entityType: ServiceEntity, id: string,
) {
  const table = tables[entityType];
  const [row] = await database.select().from(table)
    .where(and(eq(table.storeId, storeId), eq(table.id, id))).limit(1).for("update");
  if (!row) return null;
  const record = row as Record<string, unknown>;
  const snapshot = Object.fromEntries(snapshotFields.filter((key) => key in record).map((key) => [key, record[key]]));
  if (Array.isArray(record.checklist)) {
    snapshot.checklistCompleted = record.checklist.filter((item) => item?.completed === true).length;
    snapshot.checklistTotal = record.checklist.length;
    // Keep the actual checklist change detectable even when the total is unchanged.
    snapshot.checklist = record.checklist.map((item) => ({ code: item.code, completed: item.completed }));
  }
  if (typeof record.productId === "string" && !snapshot.name) {
    const [product] = await database.select({ name: products.name, code: products.sku }).from(products)
      .where(and(eq(products.storeId, storeId), eq(products.id, record.productId))).limit(1);
    if (product) Object.assign(snapshot, product);
  }
  if (typeof record.jobId === "string" && !snapshot.projectId) {
    const [job] = await database.select({ projectId: serviceJobs.projectId }).from(serviceJobs)
      .where(and(eq(serviceJobs.storeId, storeId), eq(serviceJobs.id, record.jobId))).limit(1);
    if (job) snapshot.projectId = job.projectId;
  }
  if (typeof record.assignedTo === "string") {
    const [assignee] = await database.select({ name: profiles.fullName }).from(profiles)
      .where(and(eq(profiles.storeId, storeId), eq(profiles.id, record.assignedTo))).limit(1);
    snapshot.assigneeName = assignee?.name ?? null;
  } else if ("assignedTo" in record) snapshot.assigneeName = null;
  if (typeof record.customerId === "string") {
    const [customer] = await database.select({ name: customers.name }).from(customers)
      .where(and(eq(customers.storeId, storeId), eq(customers.id, record.customerId))).limit(1);
    snapshot.customerName = customer?.name ?? null;
  } else if ("customerId" in record) snapshot.customerName = null;
  return { snapshot, values: record };
}

export async function serviceActivitySnapshot(
  database: ActivityDatabase, storeId: string, entityType: ServiceEntity, id: string,
) {
  return (await serviceActivityState(database, storeId, entityType, id))?.snapshot ?? null;
}

const volatileField = /^(?:id|storeId|createdAt|updatedAt|version)$|Version$/;

/** Runs in the caller's transaction; equal snapshots and replayed writes stay quiet. */
export async function trackServiceChange<T>(
  database: ActivityDatabase,
  actor: Actor,
  options: { action: string; entityType: ServiceEntity; id?: string | null; createdId?: (result: T) => string | undefined; metadata?: Record<string, unknown> },
  mutate: () => Promise<T>,
): Promise<T> {
  const before = options.id ? await serviceActivityState(database, actor.storeId, options.entityType, options.id) : null;
  const result = await mutate();
  const id = options.id ?? options.createdId?.(result);
  if (!id) return result;
  const after = await serviceActivityState(database, actor.storeId, options.entityType, id);
  const fields = new Set([...Object.keys(before?.values ?? {}), ...Object.keys(after?.values ?? {})]);
  const changedFields = [...fields].filter((key) => !volatileField.test(key)
    && !isDeepStrictEqual(before?.values[key], after?.values[key]));
  if (!changedFields.length) return result;
  const snapshot = after?.snapshot ?? before?.snapshot;
  await recordActivity(database, {
    storeId: actor.storeId, actorId: actor.userId, action: options.action,
    entityType: options.entityType, entityId: id, before: before?.snapshot, after: after?.snapshot,
    metadata: { ...options.metadata, projectId: snapshot?.projectId, jobId: snapshot?.jobId, deleted: !after, ...(before && after ? { changedFields } : {}) },
  });
  return result;
}
