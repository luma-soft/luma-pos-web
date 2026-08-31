import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { serviceAttachments, warrantyClaims } from "@/db/schema";
import { resolveManagedPrivateMediaUrl } from "@/lib/media/project-media";
import { getObjectStorage } from "@/lib/media/storage";
import { uuidCoordinatesEqual } from "@/lib/media/uuid-coordinate";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { getWarrantyClaimForActorCore } from "@/lib/services/technician-warranty";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id } = await params;
  const result = await db.transaction(async (tx) => {
    const [ownedClaim] = await tx.select({ id: warrantyClaims.id })
      .from(warrantyClaims).where(and(
        eq(warrantyClaims.storeId, gate.storeId),
        eq(warrantyClaims.id, id),
      )).limit(1);
    if (!ownedClaim) return null;
    const claim = await getWarrantyClaimForActorCore(tx, {
      actorId: gate.userId,
      role: gate.role,
      claimId: id,
    });
    if (!claim) return null;
    const coordinates = await tx.select({
      id: serviceAttachments.id,
      mediaObjectId: serviceAttachments.mediaObjectId,
      bucket: serviceAttachments.bucket,
      path: serviceAttachments.path,
      projectId: serviceAttachments.projectId,
      jobId: serviceAttachments.jobId,
    }).from(serviceAttachments).where(and(
      eq(serviceAttachments.storeId, gate.storeId),
      eq(serviceAttachments.claimId, claim.id),
      eq(serviceAttachments.projectId, claim.projectId),
      isNull(serviceAttachments.deletedAt),
    ));
    return { claim, coordinates };
  });
  if (!result) return mobileError("errors.notFound", 404);
  const coordinateById = new Map(
    result.coordinates.map((attachment) => [attachment.id, attachment]),
  );
  try {
    const attachments = await Promise.all(result.claim.attachments.map(async (attachment) => {
      const coordinate = coordinateById.get(attachment.id);
      if (!coordinate) throw new Error("SERVICE_WARRANTY_ATTACHMENT_NOT_FOUND");
      const mediaTarget = coordinate.jobId
        ? { purpose: "service-evidence" as const, targetId: coordinate.jobId }
        : { purpose: "project-document" as const, targetId: coordinate.projectId };
      const signedUrl = coordinate.mediaObjectId
        ? await resolveManagedPrivateMediaUrl(gate, coordinate.mediaObjectId, {
          expiresInSeconds: 15 * 60,
          expectedPurpose: mediaTarget.purpose,
          expectedTargetId: mediaTarget.targetId,
          // Claim authorization above is the stable capability. A manager may
          // reassign the claim while its historical evidence keeps the job
          // coordinate that was immutable when the file was created.
          authorizeTarget: async ({ actor, purpose, targetId }) =>
            uuidCoordinatesEqual(actor.storeId, gate.storeId)
              && uuidCoordinatesEqual(actor.userId, gate.userId)
              && purpose === mediaTarget.purpose
              && uuidCoordinatesEqual(targetId, mediaTarget.targetId)
              ? "allowed"
              : "not_found",
        })
        : await getObjectStorage("supabase").createDownloadUrl({
          bucket: coordinate.bucket,
          key: coordinate.path,
          expiresInSeconds: 15 * 60,
        });
      return { ...attachment, signedUrl };
    }));
    return mobileOk({ ...result.claim, attachments });
  } catch (error) {
    console.error("warranty evidence signing failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
