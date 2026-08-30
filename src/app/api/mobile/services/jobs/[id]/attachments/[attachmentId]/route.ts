import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { serviceAttachments, serviceJobs } from "@/db/schema";
import { resolveManagedPrivateMediaUrl } from "@/lib/media/project-media";
import { mediaServiceError } from "@/lib/media/service";
import { getObjectStorage } from "@/lib/media/storage";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { requireLockedServiceJobAccess } from "@/lib/services/field-operations";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id, attachmentId } = await params;
  try {
    const attachment = await db.transaction(async (tx) => {
      const [ownedJob] = await tx.select({ id: serviceJobs.id })
        .from(serviceJobs).where(and(
          eq(serviceJobs.storeId, gate.storeId),
          eq(serviceJobs.id, id),
        )).limit(1).for("update");
      if (!ownedJob) return null;
      await requireLockedServiceJobAccess(tx, {
        userId: gate.userId,
        role: gate.role,
      }, id);
      const [attachment] = await tx.select({
        mediaObjectId: serviceAttachments.mediaObjectId,
        bucket: serviceAttachments.bucket,
        path: serviceAttachments.path,
      }).from(serviceAttachments)
        .where(and(
          eq(serviceAttachments.id, attachmentId),
          eq(serviceAttachments.storeId, gate.storeId),
          eq(serviceAttachments.jobId, id),
          isNull(serviceAttachments.deletedAt),
        ))
        .limit(1);
      return attachment ?? null;
    });
    if (!attachment) return mobileError("errors.notFound", 404);
    const signedUrl = attachment.mediaObjectId
      ? await resolveManagedPrivateMediaUrl(gate, attachment.mediaObjectId, {
        expiresInSeconds: 15 * 60,
        expectedPurpose: "service-evidence",
        expectedTargetId: id,
      })
      : await getObjectStorage("supabase").createDownloadUrl({
        bucket: attachment.bucket,
        key: attachment.path,
        expiresInSeconds: 15 * 60,
      });
    return signedUrl
      ? mobileOk({ signedUrl })
      : mobileError("errors.notFound", 404);
  } catch (error) {
    const resolved = mediaServiceError(error);
    if (resolved.status !== 500) {
      return mobileError(resolved.error, resolved.status);
    }
    if (
      error instanceof Error
      && (
        error.message === "SERVICE_JOB_NOT_FOUND"
        || error.message === "SERVICE_JOB_FORBIDDEN"
      )
    ) return mobileError("errors.notFound", 404);
    console.error("service evidence signing failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
