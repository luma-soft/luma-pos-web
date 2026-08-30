import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  serviceAttachments,
  serviceJobEvents,
  serviceJobs,
} from "@/db/schema";
import { getFieldServiceJobDetail } from "@/lib/data/service-field";
import {
  compensateManagedMediaAssociation,
  requireReadyManagedMediaInTransaction,
} from "@/lib/media/project-media";
import { softDeleteMediaIfUnreferencedInTransaction } from "@/lib/media/repository-core";
import { getMediaService, mediaServiceError } from "@/lib/media/service";
import { getObjectStorage } from "@/lib/media/storage";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { sniffServiceEvidenceMime } from "@/lib/services/evidence-storage";
import { serviceAttachmentMetadataSchema } from "@/lib/services/schemas";
import {
  completeServiceEvidenceStorageRemoval,
  deleteServiceEvidenceCore,
} from "@/lib/services/evidence-deletion";
import {
  isServiceFieldJobTerminal,
  isServiceSnapshotJobLocked,
  mobileFieldOperation,
} from "@/lib/services/field-api";
import { requireLockedServiceJobAccess } from "@/lib/services/field-operations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id } = await params;
  const detail = await getFieldServiceJobDetail(
    { userId: gate.userId, role: gate.role },
    id,
  );
  if (!detail) return mobileError("errors.notFound", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return mobileError("errors.invalidData", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return mobileError("errors.invalidData", 400);
  const parsed = serviceAttachmentMetadataSchema.safeParse({
    jobId: id,
    category: form.get("category"),
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    caption: form.get("caption") || undefined,
  });
  if (!parsed.success) return mobileError("errors.invalidData", 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffServiceEvidenceMime(bytes.subarray(0, 16), file.type) !== file.type) {
    return mobileError("services.errors.unsupportedEvidence", 400);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  try {
    const managed = await getMediaService().putManagedObject(gate, {
      purpose: "service-evidence",
      targetId: id,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }, bytes);
    try {
      const [attachment] = await db.transaction(async (tx) => {
        await requireLockedServiceJobAccess(tx, {
          userId: gate.userId,
          role: gate.role,
        }, id);
        const media = await requireReadyManagedMediaInTransaction(tx, {
          storeId: gate.storeId,
          mediaId: managed.mediaId,
          purpose: "service-evidence",
          targetId: id,
          expectedPath: managed.path,
          sha256,
          mimeType: file.type,
          sizeBytes: file.size,
          fileName: file.name,
        });
        const rows = await tx.insert(serviceAttachments).values({
          storeId: gate.storeId,
          projectId: detail.projectId,
          jobId: id,
          mediaObjectId: media.id,
          category: parsed.data.category,
          bucket: media.bucket,
          path: media.objectKey,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          sha256,
          caption: parsed.data.caption || null,
          createdBy: gate.userId,
        }).returning({
          id: serviceAttachments.id,
          category: serviceAttachments.category,
          fileName: serviceAttachments.fileName,
          mimeType: serviceAttachments.mimeType,
          sizeBytes: serviceAttachments.sizeBytes,
          createdAt: serviceAttachments.createdAt,
        });
        await tx.insert(serviceJobEvents).values({
          jobId: id,
          eventType: "job.attachment_added",
          actorId: gate.userId,
          payload: { attachmentId: rows[0].id, category: parsed.data.category },
        });
        return rows;
      });
      return mobileOk(attachment);
    } catch (error) {
      await compensateManagedMediaAssociation(db, {
        storeId: gate.storeId,
        mediaId: managed.mediaId,
        purpose: "service-evidence",
        targetId: id,
      });
      throw error;
    }
  } catch (error) {
    const managedError = mediaServiceError(error);
    if (managedError.status !== 500) {
      return mobileError(managedError.error, managedError.status);
    }
    if (isServiceSnapshotJobLocked(error)) {
      return mobileError("services.errors.signedSnapshotLocked", 409);
    }
    if (isServiceFieldJobTerminal(error)) {
      return mobileError("services.errors.invalidTransition", 409);
    }
    if (
      error instanceof Error
      && (error.message === "SERVICE_JOB_NOT_FOUND" || error.message === "SERVICE_JOB_FORBIDDEN")
    ) {
      return mobileError("errors.notFound", 404);
    }
    console.error("service evidence upload failed:", error);
    return mobileError("errors.serverError", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id } = await params;
  const attachmentId = new URL(request.url).searchParams.get("attachmentId");
  if (!attachmentId) return mobileError("errors.invalidData", 400);
  return mobileFieldOperation(async () => {
    const result = await db.transaction(async (tx) => {
      const [ownedJob] = await tx.select({ id: serviceJobs.id })
        .from(serviceJobs).where(and(
          eq(serviceJobs.storeId, gate.storeId),
          eq(serviceJobs.id, id),
        )).limit(1).for("update");
      if (!ownedJob) throw new Error("SERVICE_JOB_NOT_FOUND");
      const [before] = await tx.select({
        mediaObjectId: serviceAttachments.mediaObjectId,
        deletedAt: serviceAttachments.deletedAt,
      }).from(serviceAttachments).where(and(
        eq(serviceAttachments.id, attachmentId),
        eq(serviceAttachments.storeId, gate.storeId),
        eq(serviceAttachments.jobId, id),
      )).limit(1).for("update");
      if (!before) throw new Error("SERVICE_ATTACHMENT_NOT_FOUND");
      const deleted = await deleteServiceEvidenceCore(tx, {
        userId: gate.userId,
        role: gate.role,
      }, { jobId: id, attachmentId });
      if (!before.mediaObjectId) return { ...deleted, managed: false };
      if (!before.deletedAt) {
        const mediaResult = await softDeleteMediaIfUnreferencedInTransaction(tx, {
          storeId: gate.storeId,
          mediaId: before.mediaObjectId,
          expectedPurpose: "service-evidence",
          expectedTargetId: id,
        });
        if (mediaResult.outcome === "conflict") {
          throw new Error("SERVICE_ATTACHMENT_MEDIA_CONFLICT");
        }
        await tx.update(serviceAttachments).set({
          storageDeletedAt: new Date(),
        }).where(and(
          eq(serviceAttachments.id, attachmentId),
          eq(serviceAttachments.jobId, id),
        ));
      }
      return { ...deleted, managed: true };
    });
    if (!result.managed && result.storagePending) {
      const legacyStorage = getObjectStorage("supabase");
      await completeServiceEvidenceStorageRemoval(db, {
        async remove(bucket, path) {
          await legacyStorage.remove({ bucket, key: path });
        },
      }, { jobId: id, attachmentId });
    }
    return { id: result.id };
  });
}
