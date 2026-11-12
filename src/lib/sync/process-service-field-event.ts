import { eq } from "drizzle-orm";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";
import { db } from "@/db";
import { serviceJobs } from "@/db/schema";
import {
  createFieldInstalledAssetCore,
  ServiceVersionConflictError,
  updateFieldChecklistCore,
  updateFieldMaterialUsageCore,
} from "@/lib/services/field-operations";
import {
  serviceChecklistUpdateSchema,
  serviceFieldAssetCreateSchema,
  serviceFieldMaterialUsageSchema,
} from "@/lib/services/schemas";
import { storeFeatureEnabled } from "@/lib/tenancy/store-features";
import type { ServiceFieldMutationRelayPayload } from "@/lib/sync/relay";

export type ServiceFieldRelayResult =
  | { status: "accepted"; result: Record<string, unknown>; errorCode: null }
  | { status: "rejected"; result: null; errorCode: string }
  | { status: "conflict"; result: Record<string, unknown>; errorCode: string };

const knownServiceRejections = new Set([
  "SERVICE_JOB_NOT_FOUND",
  "SERVICE_JOB_FORBIDDEN",
  "SERVICE_FIELD_JOB_TERMINAL",
  "SERVICE_CHECKLIST_MISMATCH",
  "SERVICE_MATERIAL_NOT_FOUND",
  "SERVICE_MUTATION_RETRY",
  "SERVICE_MUTATION_ID_CONFLICT",
  "SERVICE_MUTATION_PAYLOAD_CONFLICT",
  "SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED",
]);

export async function processServiceFieldRelayEvent(input: {
  storeId: string;
  userId: string;
  payload: unknown;
}): Promise<ServiceFieldRelayResult> {
  const principal = await resolveStoreContextForUser(input.userId);
  if (!principal || principal.storeId !== input.storeId
    || !storeFeatureEnabled(principal.features, "field_services")) {
    return { status: "rejected", result: null, errorCode: "errors.forbidden" };
  }

  const actor = { userId: principal.userId, role: principal.role };
  const payload = input.payload as Partial<ServiceFieldMutationRelayPayload> | null;
  if (!payload || typeof payload !== "object") {
    return { status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" };
  }
  if (typeof payload.jobId !== "string") {
    return { status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" };
  }
  const [job] = await db.select({ storeId: serviceJobs.storeId })
    .from(serviceJobs)
    .where(eq(serviceJobs.id, payload.jobId))
    .limit(1);
  if (!job || job.storeId !== input.storeId) {
    return { status: "rejected", result: null, errorCode: "errors.notFound" };
  }

  try {
    let result: Record<string, unknown>;
    switch (payload.type) {
      case "checklist.update": {
        const parsed = serviceChecklistUpdateSchema.safeParse(payload);
        if (!parsed.success) return { status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" };
        result = await db.transaction((tx) => updateFieldChecklistCore(tx, actor, parsed.data));
        break;
      }
      case "material.usage": {
        const parsed = serviceFieldMaterialUsageSchema.safeParse(payload);
        if (!parsed.success) return { status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" };
        result = await db.transaction((tx) => updateFieldMaterialUsageCore(tx, actor, parsed.data));
        break;
      }
      case "asset.create": {
        const parsed = serviceFieldAssetCreateSchema.safeParse(payload);
        if (!parsed.success) return { status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" };
        result = await db.transaction((tx) => createFieldInstalledAssetCore(tx, actor, parsed.data));
        break;
      }
      default:
        return { status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" };
    }

    return { status: "accepted", result, errorCode: null };
  } catch (error) {
    if (error instanceof ServiceVersionConflictError) {
      return {
        status: "conflict",
        result: error.conflict as unknown as Record<string, unknown>,
        errorCode: "SYNC_SERVICE_VERSION_CONFLICT",
      };
    }
    if (error instanceof Error && knownServiceRejections.has(error.message)) {
      return { status: "rejected", result: null, errorCode: error.message };
    }
    throw error;
  }
}
