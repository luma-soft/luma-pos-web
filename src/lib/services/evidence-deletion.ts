import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  serviceAttachments,
  serviceJobEvents,
  serviceJobs,
  serviceSignatures,
} from "@/db/schema";
import type { Role } from "@/lib/actions/common";

type ServiceTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

type ServiceEvidenceActor = { userId: string; role: Role };

export type ServiceEvidenceStorage = {
  remove(bucket: string, path: string): Promise<void>;
};

export async function deleteServiceEvidenceCore(
  tx: ServiceTransaction,
  storage: ServiceEvidenceStorage,
  actor: ServiceEvidenceActor,
  input: { jobId: string; attachmentId: string },
  now = new Date(),
) {
  const [attachment] = await tx.select({
    id: serviceAttachments.id,
    bucket: serviceAttachments.bucket,
    path: serviceAttachments.path,
    createdBy: serviceAttachments.createdBy,
  }).from(serviceAttachments)
    .where(and(
      eq(serviceAttachments.id, input.attachmentId),
      eq(serviceAttachments.jobId, input.jobId),
    ))
    .limit(1)
    .for("update");
  if (!attachment) throw new Error("SERVICE_ATTACHMENT_NOT_FOUND");

  const [job] = await tx.select({ status: serviceJobs.status })
    .from(serviceJobs)
    .where(eq(serviceJobs.id, input.jobId))
    .limit(1)
    .for("update");
  if (!job) throw new Error("SERVICE_JOB_NOT_FOUND");
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

  await storage.remove(attachment.bucket, attachment.path);

  const [deleted] = await tx.delete(serviceAttachments)
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

  return { id: attachment.id };
}
