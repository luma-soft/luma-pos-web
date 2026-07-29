import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  serviceAttachments,
  serviceJobAssignments,
  serviceJobEvents,
  serviceJobs,
  serviceSignatures,
} from "@/db/schema";
import type { Role } from "@/lib/actions/common";
import { canAccessServiceJob } from "@/lib/services/access";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

type ServiceEvidenceActor = { userId: string; role: Role };

export type ServiceEvidenceStorage = {
  remove(bucket: string, path: string): Promise<void>;
};

export async function deleteServiceEvidenceCore(
  tx: ServiceTransaction,
  actor: ServiceEvidenceActor,
  input: { jobId: string; attachmentId: string },
  now = new Date(),
) {
  const [attachment] = await tx.select({
    id: serviceAttachments.id,
    bucket: serviceAttachments.bucket,
    path: serviceAttachments.path,
    createdBy: serviceAttachments.createdBy,
    deletedAt: serviceAttachments.deletedAt,
    storageDeletedAt: serviceAttachments.storageDeletedAt,
  }).from(serviceAttachments)
    .where(and(
      eq(serviceAttachments.id, input.attachmentId),
      eq(serviceAttachments.jobId, input.jobId),
    ))
    .limit(1)
    .for("update");
  if (!attachment) throw new Error("SERVICE_ATTACHMENT_NOT_FOUND");

  const [[job], crew] = await Promise.all([
    tx.select({
      status: serviceJobs.status,
      assignedTo: serviceJobs.assignedTo,
    }).from(serviceJobs)
      .where(eq(serviceJobs.id, input.jobId))
      .limit(1)
      .for("update"),
    tx.select({ profileId: serviceJobAssignments.profileId })
      .from(serviceJobAssignments)
      .where(and(
        eq(serviceJobAssignments.jobId, input.jobId),
        isNull(serviceJobAssignments.removedAt),
      )),
  ]);
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
  if (!canAccessServiceJob({
    role: actor.role,
    profileId: actor.userId,
    primaryAssigneeId: job.assignedTo,
    crewProfileIds: crew.map((item) => item.profileId),
  })) throw new Error("SERVICE_JOB_FORBIDDEN");

  if (attachment.deletedAt) {
    return { id: attachment.id, storagePending: !attachment.storageDeletedAt };
  }

  if (job.status === "completed" || job.status === "cancelled") {
    throw new Error("SERVICE_ATTACHMENT_JOB_LOCKED");
  }

  const [signature] = await tx.select({ id: serviceSignatures.id })
    .from(serviceSignatures)
    .where(eq(serviceSignatures.attachmentId, attachment.id))
    .limit(1)
    .for("update");
  if (signature) throw new Error("SERVICE_ATTACHMENT_SIGNED");

  const canManageEvidence = actor.role === "owner" || actor.role === "manager";
  if (!canManageEvidence && attachment.createdBy !== actor.userId) {
    throw new Error("SERVICE_ATTACHMENT_FORBIDDEN");
  }

  const [deleted] = await tx.update(serviceAttachments)
    .set({
      deletedAt: now,
      deletedBy: actor.userId,
      storageDeletedAt: null,
      storageDeleteAttempts: 0,
      storageDeleteLastError: null,
    })
    .where(and(
      eq(serviceAttachments.id, attachment.id),
      eq(serviceAttachments.jobId, input.jobId),
    ))
    .returning({ id: serviceAttachments.id });
  if (!deleted) throw new Error("SERVICE_ATTACHMENT_NOT_FOUND");

  await tx.insert(serviceJobEvents).values({
    jobId: input.jobId,
    eventType: "job.attachment_deleted",
    actorId: actor.userId,
    payload: { attachmentId: attachment.id },
    createdAt: now,
  });

  return { id: attachment.id, storagePending: true };
}

export async function completeServiceEvidenceStorageRemoval(
  database: NodePgDatabase<typeof schema>,
  storage: ServiceEvidenceStorage,
  input: { jobId: string; attachmentId: string },
  now = new Date(),
) {
  const attachment = await database.transaction(async (tx) => {
    const [row] = await tx.select({
      id: serviceAttachments.id,
      bucket: serviceAttachments.bucket,
      path: serviceAttachments.path,
    }).from(serviceAttachments)
      .where(and(
        eq(serviceAttachments.id, input.attachmentId),
        eq(serviceAttachments.jobId, input.jobId),
        isNull(serviceAttachments.storageDeletedAt),
        sql`${serviceAttachments.deletedAt} is not null`,
      ))
      .limit(1)
      .for("update");
    return row;
  });
  if (!attachment) return { id: input.attachmentId, storagePending: false };

  try {
    await storage.remove(attachment.bucket, attachment.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage deletion failed";
    await database.transaction((tx) => tx.update(serviceAttachments).set({
      storageDeleteAttempts: sql`${serviceAttachments.storageDeleteAttempts} + 1`,
      storageDeleteLastError: message,
    }).where(and(
      eq(serviceAttachments.id, attachment.id),
      isNull(serviceAttachments.storageDeletedAt),
    )));
    throw error;
  }

  await database.transaction((tx) => tx.update(serviceAttachments).set({
    storageDeletedAt: now,
    storageDeleteLastError: null,
  }).where(and(
    eq(serviceAttachments.id, attachment.id),
    isNull(serviceAttachments.storageDeletedAt),
  )));
  return { id: attachment.id, storagePending: false };
}
