import { recordActivity } from "@/lib/audit/activity-log";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import sharp from "sharp";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  profiles,
  serviceCustomerRequestNotifications,
  serviceCustomerRequests,
  serviceCustomerRequestAttachments,
  serviceCustomerRequestStorageCleanup,
  serviceJobs,
  servicePublicRateLimits,
} from "@/db/schema";
import { isCustomerRequestTokenSubmittable } from "@/lib/services/customer-request-token";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

export const CUSTOMER_REQUEST_EVIDENCE_BUCKET = "service-customer-request-evidence";
export const CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;
export const CUSTOMER_REQUEST_EVIDENCE_MAX_DIMENSION = 6000;
export const CUSTOMER_REQUEST_EVIDENCE_MAX_PIXELS = 20_000_000;
export const CUSTOMER_REQUEST_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function completePng(bytes: Uint8Array) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    const length = view.getUint32(0, false);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = new TextDecoder("ascii").decode(bytes.subarray(offset + 4, offset + 8));
    if (type === "IEND") return length === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

function structurallyComplete(bytes: Uint8Array, format: string) {
  if (format === "jpeg") return (
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  );
  if (format === "png") return (
    bytes.slice(0, 8).every((value, index) =>
      value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
    && completePng(bytes)
  );
  if (format === "webp") {
    const text = new TextDecoder("ascii").decode(bytes.subarray(0, 12));
    return text.startsWith("RIFF") && text.slice(8, 12) === "WEBP"
      && bytes.length >= 12
      && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length;
  }
  return false;
}

const imageContract = {
  jpeg: { mimeType: "image/jpeg" as const, extensions: ["jpg", "jpeg"], extension: "jpg" },
  png: { mimeType: "image/png" as const, extensions: ["png"], extension: "png" },
  webp: { mimeType: "image/webp" as const, extensions: ["webp"], extension: "webp" },
};

export async function sanitizeCustomerRequestEvidence(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
  fileName: string;
}) {
  if (input.bytes.length < 12 || input.bytes.length > CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES) return null;
  try {
    const decoder = sharp(input.bytes, {
      failOn: "error",
      limitInputPixels: CUSTOMER_REQUEST_EVIDENCE_MAX_PIXELS,
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();
    const contract = metadata.format && metadata.format in imageContract
      ? imageContract[metadata.format as keyof typeof imageContract]
      : null;
    const extension = input.fileName.split(".").pop()?.toLowerCase() ?? "";
    if (
      !contract
      || input.declaredMimeType.toLowerCase() !== contract.mimeType
      || !contract.extensions.includes(extension)
      || !structurallyComplete(input.bytes, metadata.format ?? "")
      || !metadata.width || !metadata.height
      || metadata.width > CUSTOMER_REQUEST_EVIDENCE_MAX_DIMENSION
      || metadata.height > CUSTOMER_REQUEST_EVIDENCE_MAX_DIMENSION
      || metadata.width * metadata.height > CUSTOMER_REQUEST_EVIDENCE_MAX_PIXELS
      || (metadata.pages ?? 1) !== 1
    ) return null;
    const pipeline = sharp(input.bytes, {
      failOn: "error",
      limitInputPixels: CUSTOMER_REQUEST_EVIDENCE_MAX_PIXELS,
      sequentialRead: true,
    }).rotate();
    const output = contract.mimeType === "image/jpeg"
      ? await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
      : contract.mimeType === "image/png"
        ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
        : await pipeline.webp({ quality: 88 }).toBuffer();
    if (output.length > CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES) return null;
    const canonical = await sharp(output, {
      failOn: "error",
      limitInputPixels: CUSTOMER_REQUEST_EVIDENCE_MAX_PIXELS,
    }).metadata();
    if (!canonical.width || !canonical.height) return null;
    return {
      bytes: new Uint8Array(output),
      mimeType: contract.mimeType,
      extension: contract.extension,
      width: canonical.width,
      height: canonical.height,
      sha256: createHash("sha256").update(output).digest("hex"),
    };
  } catch {
    return null;
  }
}

export function calculateCustomerRequestSlaState(input: {
  now?: Date;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  respondedAt: Date | null;
  resolvedAt: Date | null;
}) {
  const now = input.now ?? new Date();
  return {
    responseOverdue: !input.respondedAt
      && Boolean(input.responseDueAt && input.responseDueAt.getTime() < now.getTime()),
    resolutionOverdue: !input.resolvedAt
      && Boolean(input.resolutionDueAt && input.resolutionDueAt.getTime() < now.getTime()),
  };
}

const customerRequestTransitions: Record<string, readonly string[]> = {
  new: ["triaged", "void"],
  triaged: ["scheduled", "void"],
  scheduled: ["in_progress", "void"],
  in_progress: ["resolved", "void"],
  resolved: ["closed", "in_progress"],
  closed: [],
  void: [],
};

export function canTransitionCustomerRequest(
  from: string,
  to: string,
  hasLinkedJob: boolean,
) {
  if (!customerRequestTransitions[from]?.includes(to)) return false;
  if (["scheduled", "in_progress", "resolved", "closed"].includes(to) && !hasLinkedJob) {
    return false;
  }
  return true;
}

export async function consumePublicRateLimitCore(
  tx: ServiceTransaction,
  input: { storeId: string; key: string; limit: number; windowSeconds: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [bucket] = await tx.insert(servicePublicRateLimits).values({
    storeId: input.storeId,
    bucketKey: `${input.storeId}:${input.key}`,
    windowStart,
    requestCount: 1,
    expiresAt: new Date(windowStart.getTime() + windowMs * 2),
  }).onConflictDoUpdate({
    target: [servicePublicRateLimits.bucketKey, servicePublicRateLimits.windowStart],
    set: {
      requestCount: sql`${servicePublicRateLimits.requestCount} + 1`,
      expiresAt: new Date(windowStart.getTime() + windowMs * 2),
    },
  }).returning({ requestCount: servicePublicRateLimits.requestCount });
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
  );
  return {
    allowed: bucket.requestCount <= input.limit,
    remaining: Math.max(0, input.limit - bucket.requestCount),
    retryAfterSeconds,
  };
}

export async function submitCustomerRequestCore(
  tx: ServiceTransaction,
  input: {
    requestId: string;
    title: string;
    description: string;
    contactName: string;
    contactPhone: string;
    priority: "low" | "normal" | "high" | "urgent";
    now?: Date;
    responseMinutes: number | null;
    resolutionMinutes: number | null;
    attachments?: Array<{
      cleanupId: string;
      bucket: string;
      path: string;
      fileName: string;
      mimeType: "image/jpeg" | "image/png" | "image/webp";
      sizeBytes: number;
      width: number;
      height: number;
      sha256: string;
    }>;
  },
) {
  const now = input.now ?? new Date();
  const [current] = await tx.select({
    id: serviceCustomerRequests.id,
    storeId: serviceCustomerRequests.storeId,
    code: serviceCustomerRequests.code,
    title: serviceCustomerRequests.title,
    internalNote: serviceCustomerRequests.internalNote,
    status: serviceCustomerRequests.status,
    submittedAt: serviceCustomerRequests.submittedAt,
    tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
  }).from(serviceCustomerRequests)
    .where(eq(serviceCustomerRequests.id, input.requestId))
    .for("update")
    .limit(1);
  if (!current || !isCustomerRequestTokenSubmittable({
    status: current.status,
    submittedAt: current.submittedAt,
    expiresAt: current.tokenExpiresAt,
    now,
  })) throw new Error("CUSTOMER_REQUEST_NOT_SUBMITTABLE");
  if ((input.attachments?.length ?? 0) > 3) {
    throw new Error("CUSTOMER_REQUEST_EVIDENCE_LIMIT");
  }
  if (input.attachments?.length) {
    const cleanupRows = await tx.select({
      id: serviceCustomerRequestStorageCleanup.id,
      requestId: serviceCustomerRequestStorageCleanup.requestId,
      bucket: serviceCustomerRequestStorageCleanup.bucket,
      path: serviceCustomerRequestStorageCleanup.path,
      claimToken: serviceCustomerRequestStorageCleanup.claimToken,
    }).from(serviceCustomerRequestStorageCleanup).where(inArray(
      serviceCustomerRequestStorageCleanup.id,
      input.attachments.map((attachment) => attachment.cleanupId),
    )).for("update");
    if (
      cleanupRows.length !== input.attachments.length
      || input.attachments.some((attachment) => {
        const cleanup = cleanupRows.find((row) => row.id === attachment.cleanupId);
        return !cleanup
          || cleanup.requestId !== current.id
          || cleanup.bucket !== attachment.bucket
          || cleanup.path !== attachment.path
          || cleanup.claimToken !== null;
      })
    ) throw new Error("CUSTOMER_REQUEST_STORAGE_CLEANUP_CLAIMED");
  }

  const responseDueAt = input.responseMinutes
    ? new Date(now.getTime() + input.responseMinutes * 60_000)
    : null;
  const resolutionDueAt = input.resolutionMinutes
    ? new Date(now.getTime() + input.resolutionMinutes * 60_000)
    : null;
  const [updated] = await tx.update(serviceCustomerRequests).set({
    title: input.title,
    description: input.description,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    priority: input.priority,
    status: "new",
    submittedAt: now,
    responseDueAt,
    resolutionDueAt,
    updatedAt: now,
  }).where(eq(serviceCustomerRequests.id, current.id)).returning({
    id: serviceCustomerRequests.id,
    code: serviceCustomerRequests.code,
    status: serviceCustomerRequests.status,
  });
  if (input.attachments?.length) {
    await tx.insert(serviceCustomerRequestAttachments).values(
      input.attachments.map((attachment) => ({
        storeId: current.storeId,
        requestId: current.id,
        bucket: attachment.bucket,
        path: attachment.path,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
        sha256: attachment.sha256,
      })),
    );
    await tx.delete(serviceCustomerRequestStorageCleanup).where(inArray(
      serviceCustomerRequestStorageCleanup.id,
      input.attachments.map((attachment) => attachment.cleanupId),
    ));
  }
  const managers = await tx.select({ id: profiles.id }).from(profiles).where(and(
    eq(profiles.storeId, current.storeId),
    eq(profiles.isActive, true),
    inArray(profiles.role, ["owner", "manager"]),
  ));
  if (managers.length > 0) {
    await tx.insert(serviceCustomerRequestNotifications).values(
      managers.map((manager) => ({
        storeId: current.storeId,
        requestId: current.id,
        recipientId: manager.id,
        notificationType: "submitted",
      })),
    ).onConflictDoNothing();
  }
  await recordActivity(tx, { storeId: current.storeId, actorId: null, source: "system",
    action: "service.customer_request.submitted", entityType: "service_customer_request", entityId: current.id,
    after: { code: updated.code, name: input.title, status: updated.status, priority: input.priority },
    metadata: { submittedByCustomer: true, attachmentCount: input.attachments?.length ?? 0 },
  });
  return {
    ...updated,
    responseDueAt,
    resolutionDueAt,
    notificationUserIds: managers.map((manager) => manager.id),
  };
}

export async function manageCustomerRequestCore(
  tx: ServiceTransaction,
  input: {
    requestId: string;
    actorId: string;
    status?: string;
    linkedJobId?: string | null;
    internalNote?: string | null;
    now?: Date;
  },
) {
  const [current] = await tx.select({
    id: serviceCustomerRequests.id,
    storeId: serviceCustomerRequests.storeId,
    code: serviceCustomerRequests.code,
    title: serviceCustomerRequests.title,
    internalNote: serviceCustomerRequests.internalNote,
    projectId: serviceCustomerRequests.projectId,
    status: serviceCustomerRequests.status,
    linkedJobId: serviceCustomerRequests.linkedJobId,
    respondedAt: serviceCustomerRequests.respondedAt,
    resolvedAt: serviceCustomerRequests.resolvedAt,
    submittedAt: serviceCustomerRequests.submittedAt,
  }).from(serviceCustomerRequests)
    .where(eq(serviceCustomerRequests.id, input.requestId))
    .for("update")
    .limit(1);
  if (!current?.submittedAt) throw new Error("CUSTOMER_REQUEST_NOT_FOUND");
  const linkedJobId = input.linkedJobId === undefined
    ? current.linkedJobId
    : input.linkedJobId;
  if (linkedJobId) {
    const [job] = await tx.select({ projectId: serviceJobs.projectId })
      .from(serviceJobs)
      .where(eq(serviceJobs.id, linkedJobId))
      .limit(1);
    if (!job || job.projectId !== current.projectId) {
      throw new Error("CUSTOMER_REQUEST_JOB_MISMATCH");
    }
  }
  const nextStatus = input.status ?? current.status;
  if (
    ["scheduled", "in_progress", "resolved", "closed"].includes(nextStatus)
    && !linkedJobId
  ) throw new Error("CUSTOMER_REQUEST_JOB_REQUIRED");
  if (
    input.status
    && input.status !== current.status
    && !canTransitionCustomerRequest(current.status, input.status, Boolean(linkedJobId))
  ) throw new Error("CUSTOMER_REQUEST_INVALID_TRANSITION");
  const now = input.now ?? new Date();
  const [updated] = await tx.update(serviceCustomerRequests).set({
    status: nextStatus,
    linkedJobId,
    internalNote: input.internalNote === undefined ? undefined : input.internalNote,
    triagedBy: nextStatus !== "new" ? input.actorId : undefined,
    respondedAt: !current.respondedAt && nextStatus !== "new" ? now : current.respondedAt,
    resolvedAt: current.status === "resolved" && nextStatus === "in_progress"
      ? null
      : !current.resolvedAt && ["resolved", "closed"].includes(nextStatus)
        ? now
        : current.resolvedAt,
    updatedAt: now,
  }).where(eq(serviceCustomerRequests.id, current.id)).returning();
  if (current.status !== updated.status || current.linkedJobId !== updated.linkedJobId || current.internalNote !== updated.internalNote) {
    await recordActivity(tx, { storeId: current.storeId, actorId: input.actorId,
      action: "service.customer_request.updated", entityType: "service_customer_request", entityId: current.id,
      before: { code: current.code, name: current.title, status: current.status, jobId: current.linkedJobId },
      after: { code: updated.code, name: updated.title, status: updated.status, jobId: updated.linkedJobId },
      metadata: { projectId: current.projectId, noteChanged: current.internalNote !== updated.internalNote },
    });
  }
  return updated;
}

export async function stageCustomerRequestStorageCleanupCore(
  tx: ServiceTransaction,
  input: {
    requestId: string;
    objects: Array<{ bucket: string; path: string }>;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (input.objects.length === 0) return [];
  const [request] = await tx.select({ storeId: serviceCustomerRequests.storeId })
    .from(serviceCustomerRequests)
    .where(eq(serviceCustomerRequests.id, input.requestId))
    .limit(1);
  if (!request) throw new Error("CUSTOMER_REQUEST_NOT_FOUND");
  return tx.insert(serviceCustomerRequestStorageCleanup).values(
    input.objects.map((object) => ({
      storeId: request.storeId,
      requestId: input.requestId,
      bucket: object.bucket,
      path: object.path,
      notBefore: new Date(now.getTime() + 15 * 60 * 1000),
    })),
  ).returning({
    id: serviceCustomerRequestStorageCleanup.id,
    bucket: serviceCustomerRequestStorageCleanup.bucket,
    path: serviceCustomerRequestStorageCleanup.path,
  });
}

const CUSTOMER_REQUEST_CLEANUP_LEASE_MS = 5 * 60 * 1000;

export async function drainCustomerRequestStorageCleanup(input: {
  database: NodePgDatabase<typeof schema>;
  storage: { remove(bucket: string, path: string): Promise<void> };
  now?: Date;
  limit?: number;
}) {
  const now = input.now ?? new Date();
  const staleAt = new Date(now.getTime() - CUSTOMER_REQUEST_CLEANUP_LEASE_MS);
  const candidates = await input.database.select({
    id: serviceCustomerRequestStorageCleanup.id,
  }).from(serviceCustomerRequestStorageCleanup).where(and(
    lte(serviceCustomerRequestStorageCleanup.notBefore, now),
    or(
      isNull(serviceCustomerRequestStorageCleanup.claimedAt),
      lt(serviceCustomerRequestStorageCleanup.claimedAt, staleAt),
    ),
  )).limit(Math.min(100, Math.max(1, input.limit ?? 25)));
  let cleaned = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claimToken = randomUUID();
    const [claimed] = await input.database.update(serviceCustomerRequestStorageCleanup).set({
      claimToken,
      claimedAt: now,
    }).where(and(
      eq(serviceCustomerRequestStorageCleanup.id, candidate.id),
      or(
        isNull(serviceCustomerRequestStorageCleanup.claimedAt),
        lt(serviceCustomerRequestStorageCleanup.claimedAt, staleAt),
      ),
    )).returning({
      id: serviceCustomerRequestStorageCleanup.id,
      bucket: serviceCustomerRequestStorageCleanup.bucket,
      path: serviceCustomerRequestStorageCleanup.path,
    });
    if (!claimed) continue;
    try {
      await input.storage.remove(claimed.bucket, claimed.path);
      await input.database.delete(serviceCustomerRequestStorageCleanup).where(and(
        eq(serviceCustomerRequestStorageCleanup.id, claimed.id),
        eq(serviceCustomerRequestStorageCleanup.claimToken, claimToken),
      ));
      cleaned++;
    } catch (error) {
      await input.database.update(serviceCustomerRequestStorageCleanup).set({
        attempts: sql`${serviceCustomerRequestStorageCleanup.attempts} + 1`,
        lastError: error instanceof Error ? error.message.slice(0, 1000) : "Storage cleanup failed",
        claimToken: null,
        claimedAt: null,
        notBefore: new Date(now.getTime() + 5 * 60 * 1000),
      }).where(and(
        eq(serviceCustomerRequestStorageCleanup.id, claimed.id),
        eq(serviceCustomerRequestStorageCleanup.claimToken, claimToken),
      ));
      failed++;
    }
  }
  return { evaluated: candidates.length, cleaned, failed };
}
