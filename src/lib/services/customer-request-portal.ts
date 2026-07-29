import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  profiles,
  serviceCustomerRequestNotifications,
  serviceCustomerRequests,
  serviceJobs,
  servicePublicRateLimits,
} from "@/db/schema";
import { isCustomerRequestTokenSubmittable } from "@/lib/services/customer-request-token";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

export const CUSTOMER_REQUEST_EVIDENCE_BUCKET = "service-customer-request-evidence";
export const CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;
export const CUSTOMER_REQUEST_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

function ascii(bytes: Uint8Array) {
  return new TextDecoder("latin1").decode(bytes);
}

export function sniffCustomerRequestEvidence(bytes: Uint8Array): {
  mimeType: (typeof CUSTOMER_REQUEST_EVIDENCE_MIME_TYPES)[number];
  extension: string;
} | null {
  if (bytes.length < 10 || bytes.length > CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES) return null;
  const text = ascii(bytes);
  const activeContent = /<script|javascript:|\/javascript|\/launch|\/embeddedfile/i.test(text);
  if (activeContent) return null;
  if (
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  ) return { mimeType: "image/jpeg", extension: "jpg" };
  if (
    bytes.slice(0, 8).every((value, index) =>
      value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
    && bytes.slice(-12).some((_, index, tail) =>
      index <= tail.length - 4
      && tail[index] === 0x49 && tail[index + 1] === 0x45
      && tail[index + 2] === 0x4e && tail[index + 3] === 0x44)
  ) return { mimeType: "image/png", extension: "png" };
  if (
    text.startsWith("RIFF") && text.slice(8, 12) === "WEBP"
    && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length
  ) return { mimeType: "image/webp", extension: "webp" };
  if (text.startsWith("%PDF-") && /%%EOF\s*$/.test(text)) {
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  return null;
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
  input: { key: string; limit: number; windowSeconds: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [bucket] = await tx.insert(servicePublicRateLimits).values({
    bucketKey: input.key,
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
  },
) {
  const now = input.now ?? new Date();
  const [current] = await tx.select({
    id: serviceCustomerRequests.id,
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
  const managers = await tx.select({ id: profiles.id }).from(profiles).where(and(
    eq(profiles.isActive, true),
    inArray(profiles.role, ["owner", "manager"]),
  ));
  if (managers.length > 0) {
    await tx.insert(serviceCustomerRequestNotifications).values(
      managers.map((manager) => ({
        requestId: current.id,
        recipientId: manager.id,
        notificationType: "submitted",
      })),
    ).onConflictDoNothing();
  }
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
    projectId: serviceCustomerRequests.projectId,
    status: serviceCustomerRequests.status,
    linkedJobId: serviceCustomerRequests.linkedJobId,
    respondedAt: serviceCustomerRequests.respondedAt,
    resolvedAt: serviceCustomerRequests.resolvedAt,
  }).from(serviceCustomerRequests)
    .where(eq(serviceCustomerRequests.id, input.requestId))
    .for("update")
    .limit(1);
  if (!current) throw new Error("CUSTOMER_REQUEST_NOT_FOUND");
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
    resolvedAt: !current.resolvedAt && ["resolved", "closed"].includes(nextStatus)
      ? now
      : current.resolvedAt,
    updatedAt: now,
  }).where(eq(serviceCustomerRequests.id, current.id)).returning();
  return updated;
}
