import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  auditLogs,
  installedAssets,
  profiles,
  projects,
  serviceAttachments,
  serviceCustomerRequestStorageCleanup,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobs,
  warrantyClaimNotifications,
  warrantyClaims,
} from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import { sanitizeCustomerRequestEvidence } from "@/lib/services/customer-request-portal";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

type WarrantyActorRole = Role;

const managerRoles = ["owner", "manager"] as const;

function claimCode(now: Date) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `BH-${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createTechnicianWarrantyClaimCore(
  tx: ServiceTransaction,
  input: {
    claimId?: string;
    actorId: string;
    jobId: string;
    assetId: string;
    title: string;
    description?: string | null;
    priority: "low" | "normal" | "high" | "urgent";
    scheduledAt?: Date | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [job] = await tx.select({
    id: serviceJobs.id,
    projectId: serviceJobs.projectId,
    status: serviceJobs.status,
  }).from(serviceJobs)
    .where(eq(serviceJobs.id, input.jobId))
    .limit(1)
    .for("update");
  if (!job) throw new Error("SERVICE_WARRANTY_JOB_NOT_FOUND");
  if (job.status === "cancelled") throw new Error("SERVICE_WARRANTY_JOB_CANCELLED");

  const [assignment] = await tx.select({ id: serviceJobAssignments.id })
    .from(serviceJobAssignments)
    .innerJoin(profiles, eq(serviceJobAssignments.profileId, profiles.id))
    .where(and(
      eq(serviceJobAssignments.jobId, job.id),
      eq(serviceJobAssignments.profileId, input.actorId),
      isNull(serviceJobAssignments.removedAt),
      eq(profiles.role, "technician"),
      eq(profiles.isActive, true),
    ))
    .limit(1);
  if (!assignment) throw new Error("SERVICE_WARRANTY_FORBIDDEN");

  const [asset] = await tx.select({
    id: installedAssets.id,
    projectId: installedAssets.projectId,
    jobId: installedAssets.jobId,
    status: installedAssets.status,
  }).from(installedAssets)
    .where(eq(installedAssets.id, input.assetId))
    .limit(1)
    .for("key share");
  if (
    !asset
    || asset.projectId !== job.projectId
    || asset.jobId !== job.id
    || asset.status === "removed"
  ) throw new Error("SERVICE_WARRANTY_ASSET_MISMATCH");

  const title = input.title.trim();
  if (!title) throw new Error("SERVICE_WARRANTY_INVALID");
  const [claim] = await tx.insert(warrantyClaims).values({
    id: input.claimId,
    projectId: job.projectId,
    jobId: job.id,
    assetId: asset.id,
    code: claimCode(now),
    title,
    description: input.description?.trim() || null,
    priority: input.priority,
    scheduledAt: input.scheduledAt ?? null,
    createdBy: input.actorId,
    reportedAt: now,
    createdAt: now,
    updatedAt: now,
  }).returning();

  await tx.insert(serviceJobEvents).values({
    jobId: job.id,
    eventType: "job.warranty_claim_created",
    actorId: input.actorId,
    payload: {
      claimId: claim.id,
      assetId: asset.id,
      priority: claim.priority,
      scheduledAt: claim.scheduledAt?.toISOString() ?? null,
    },
    createdAt: now,
  });
  await tx.insert(auditLogs).values({
    actorId: input.actorId,
    source: "mobile",
    action: "service_warranty_claim.create",
    entityType: "warranty_claim",
    entityId: claim.id,
    after: {
      projectId: job.projectId,
      jobId: job.id,
      assetId: asset.id,
      status: claim.status,
      priority: claim.priority,
    },
    affectedRecords: [
      { entityType: "service_job", entityId: job.id },
      { entityType: "installed_asset", entityId: asset.id },
    ],
    createdAt: now,
  });
  const managers = await tx.select({ id: profiles.id }).from(profiles).where(and(
    eq(profiles.isActive, true),
    inArray(profiles.role, managerRoles),
  )).orderBy(asc(profiles.id));
  if (managers.length > 0) {
    await tx.insert(warrantyClaimNotifications).values(
      managers.map((manager) => ({
        claimId: claim.id,
        recipientId: manager.id,
        notificationType: "created" as const,
        createdAt: now,
      })),
    ).onConflictDoNothing();
  }
  await tx.update(projects).set({
    serviceStage: "warranty",
  }).where(eq(projects.id, job.projectId));

  return {
    ...claim,
    notificationUserIds: managers.map((manager) => manager.id),
  };
}

export async function stageServiceStorageCleanupCore(
  tx: ServiceTransaction,
  input: { bucket: string; path: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return tx.insert(serviceCustomerRequestStorageCleanup).values({
    requestId: null,
    bucket: input.bucket,
    path: input.path,
    notBefore: new Date(now.getTime() + 15 * 60 * 1000),
  }).returning({
    id: serviceCustomerRequestStorageCleanup.id,
    bucket: serviceCustomerRequestStorageCleanup.bucket,
    path: serviceCustomerRequestStorageCleanup.path,
  });
}

export async function finalizeTechnicianWarrantyClaimEvidenceCore(
  tx: ServiceTransaction,
  input: {
    claim: Parameters<typeof createTechnicianWarrantyClaimCore>[1];
    cleanupId: string;
    bucket: string;
    path: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  },
) {
  const [cleanup] = await tx.select({
    id: serviceCustomerRequestStorageCleanup.id,
    bucket: serviceCustomerRequestStorageCleanup.bucket,
    path: serviceCustomerRequestStorageCleanup.path,
    claimToken: serviceCustomerRequestStorageCleanup.claimToken,
  }).from(serviceCustomerRequestStorageCleanup)
    .where(eq(serviceCustomerRequestStorageCleanup.id, input.cleanupId))
    .limit(1)
    .for("update");
  if (
    !cleanup
    || cleanup.bucket !== input.bucket
    || cleanup.path !== input.path
    || cleanup.claimToken !== null
  ) throw new Error("SERVICE_WARRANTY_STORAGE_CLEANUP_INVALID");
  const claim = await createTechnicianWarrantyClaimCore(tx, input.claim);
  await tx.insert(serviceAttachments).values({
    projectId: claim.projectId,
    jobId: claim.jobId,
    claimId: claim.id,
    assetId: claim.assetId,
    category: "issue",
    bucket: input.bucket,
    path: input.path,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    createdBy: input.claim.actorId,
  });
  await tx.delete(serviceCustomerRequestStorageCleanup).where(eq(
    serviceCustomerRequestStorageCleanup.id,
    cleanup.id,
  ));
  return claim;
}

function technicianClaimFilter(actorId: string) {
  return sql`exists (
    select 1
    from ${serviceJobAssignments} assignment
    inner join ${profiles} technician
      on technician.id = assignment.profile_id
    where assignment.job_id = ${warrantyClaims.jobId}
      and assignment.profile_id = ${actorId}
      and assignment.removed_at is null
      and technician.is_active = true
      and technician.role = 'technician'
  )`;
}

export async function sanitizeTechnicianWarrantyEvidence(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
  fileName: string;
}) {
  return sanitizeCustomerRequestEvidence(input);
}

export async function listWarrantyClaimsForActorCore(
  database: NodePgDatabase<typeof schema> | ServiceTransaction,
  input: { actorId: string; role: WarrantyActorRole; jobId?: string | null },
) {
  return database.select({
    id: warrantyClaims.id,
    code: warrantyClaims.code,
    projectId: warrantyClaims.projectId,
    jobId: warrantyClaims.jobId,
    assetId: warrantyClaims.assetId,
    assetName: installedAssets.name,
    title: warrantyClaims.title,
    description: warrantyClaims.description,
    status: warrantyClaims.status,
    priority: warrantyClaims.priority,
    reportedAt: warrantyClaims.reportedAt,
    scheduledAt: warrantyClaims.scheduledAt,
  }).from(warrantyClaims)
    .innerJoin(installedAssets, eq(warrantyClaims.assetId, installedAssets.id))
    .where(and(
      input.jobId ? eq(warrantyClaims.jobId, input.jobId) : undefined,
      input.role === "technician" ? technicianClaimFilter(input.actorId) : undefined,
    ))
    .orderBy(desc(warrantyClaims.reportedAt));
}

export async function getWarrantyClaimForActorCore(
  database: ServiceTransaction,
  input: { actorId: string; role: WarrantyActorRole; claimId: string },
) {
  const [scope] = await database.select({
    id: warrantyClaims.id,
    jobId: warrantyClaims.jobId,
  }).from(warrantyClaims)
    .where(eq(warrantyClaims.id, input.claimId))
    .limit(1);
  if (!scope) return null;
  if (scope.jobId) {
    const [lockedJob] = await database.select({ id: serviceJobs.id })
      .from(serviceJobs)
      .where(eq(serviceJobs.id, scope.jobId))
      .limit(1)
      .for("update");
    if (!lockedJob) return null;
  } else if (input.role === "technician") {
    return null;
  }
  if (input.role === "technician") {
    const [assignment] = await database.select({ id: serviceJobAssignments.id })
      .from(serviceJobAssignments)
      .innerJoin(profiles, eq(serviceJobAssignments.profileId, profiles.id))
      .where(and(
        eq(serviceJobAssignments.jobId, scope.jobId!),
        eq(serviceJobAssignments.profileId, input.actorId),
        isNull(serviceJobAssignments.removedAt),
        eq(profiles.isActive, true),
        eq(profiles.role, "technician"),
      ))
      .limit(1);
    if (!assignment) return null;
  }
  const [claim] = await database.select({
    id: warrantyClaims.id,
    code: warrantyClaims.code,
    projectId: warrantyClaims.projectId,
    projectName: projects.name,
    jobId: warrantyClaims.jobId,
    assetId: warrantyClaims.assetId,
    assetName: installedAssets.name,
    title: warrantyClaims.title,
    description: warrantyClaims.description,
    status: warrantyClaims.status,
    priority: warrantyClaims.priority,
    reportedAt: warrantyClaims.reportedAt,
    scheduledAt: warrantyClaims.scheduledAt,
    diagnosis: warrantyClaims.diagnosis,
    resolution: warrantyClaims.resolution,
  }).from(warrantyClaims)
    .innerJoin(projects, eq(warrantyClaims.projectId, projects.id))
    .innerJoin(installedAssets, eq(warrantyClaims.assetId, installedAssets.id))
    .where(and(
      eq(warrantyClaims.id, input.claimId),
    ))
    .limit(1);
  if (!claim) return null;
  const attachments = await database.select({
    id: serviceAttachments.id,
    fileName: serviceAttachments.fileName,
    mimeType: serviceAttachments.mimeType,
    sizeBytes: serviceAttachments.sizeBytes,
    sha256: serviceAttachments.sha256,
    caption: serviceAttachments.caption,
    createdAt: serviceAttachments.createdAt,
  }).from(serviceAttachments).where(and(
    eq(serviceAttachments.claimId, claim.id),
    isNull(serviceAttachments.deletedAt),
  )).orderBy(desc(serviceAttachments.createdAt));
  return { ...claim, attachments };
}

export async function listWarrantyNotificationsForRecipientCore(
  database: NodePgDatabase<typeof schema> | ServiceTransaction,
  recipientId: string,
) {
  return database.select({
    id: warrantyClaimNotifications.id,
    notificationId: sql<string>`'warranty-' || ${warrantyClaimNotifications.id}::text`,
    claimId: warrantyClaims.id,
    jobId: warrantyClaims.jobId,
    code: warrantyClaims.code,
    title: warrantyClaims.title,
    priority: warrantyClaims.priority,
    assetName: installedAssets.name,
    projectName: projects.name,
    createdAt: warrantyClaimNotifications.createdAt,
  }).from(warrantyClaimNotifications)
    .innerJoin(warrantyClaims, eq(warrantyClaimNotifications.claimId, warrantyClaims.id))
    .innerJoin(projects, eq(warrantyClaims.projectId, projects.id))
    .leftJoin(installedAssets, eq(warrantyClaims.assetId, installedAssets.id))
    .where(eq(warrantyClaimNotifications.recipientId, recipientId))
    .orderBy(desc(warrantyClaimNotifications.createdAt));
}

const WARRANTY_PUSH_LEASE_MS = 5 * 60 * 1000;

export async function claimWarrantyNotificationDeliveriesCore(
  database: NodePgDatabase<typeof schema>,
  input: { now?: Date; limit?: number } = {},
) {
  const now = input.now ?? new Date();
  const staleAt = new Date(now.getTime() - WARRANTY_PUSH_LEASE_MS);
  const candidates = await database.select({
    id: warrantyClaimNotifications.id,
  }).from(warrantyClaimNotifications).where(and(
    isNull(warrantyClaimNotifications.pushDispatchedAt),
    or(
      isNull(warrantyClaimNotifications.pushClaimedAt),
      lt(warrantyClaimNotifications.pushClaimedAt, staleAt),
    ),
  )).orderBy(asc(warrantyClaimNotifications.createdAt))
    .limit(Math.min(100, Math.max(1, input.limit ?? 25)));
  const claimed = [];
  for (const candidate of candidates) {
    const claimToken = randomUUID();
    const [row] = await database.update(warrantyClaimNotifications).set({
      pushClaimToken: claimToken,
      pushClaimedAt: now,
    }).where(and(
      eq(warrantyClaimNotifications.id, candidate.id),
      isNull(warrantyClaimNotifications.pushDispatchedAt),
      or(
        isNull(warrantyClaimNotifications.pushClaimedAt),
        lt(warrantyClaimNotifications.pushClaimedAt, staleAt),
      ),
    )).returning({
      id: warrantyClaimNotifications.id,
      recipientId: warrantyClaimNotifications.recipientId,
      claimId: warrantyClaimNotifications.claimId,
    });
    if (!row) continue;
    const [claim] = await database.select({
      jobId: warrantyClaims.jobId,
    }).from(warrantyClaims).where(eq(warrantyClaims.id, row.claimId)).limit(1);
    claimed.push({ ...row, claimToken, jobId: claim?.jobId ?? null });
  }
  return claimed;
}

export async function completeWarrantyNotificationDeliveryCore(
  database: NodePgDatabase<typeof schema>,
  input: {
    id: string;
    claimToken: string;
    delivered: boolean;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [updated] = await database.update(warrantyClaimNotifications).set({
    pushAttemptedAt: now,
    pushDispatchedAt: input.delivered ? now : null,
    pushClaimToken: null,
    pushClaimedAt: null,
  }).where(and(
    eq(warrantyClaimNotifications.id, input.id),
    eq(warrantyClaimNotifications.pushClaimToken, input.claimToken),
  )).returning({ id: warrantyClaimNotifications.id });
  return Boolean(updated);
}
