import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  mediaObjects,
  serviceCustomerRequestAttachments,
  serviceCustomerRequests,
} from "@/db/schema";
import { resolveManagedPrivateMediaUrl } from "@/lib/media/project-media";
import { mediaServiceError } from "@/lib/media/service";
import { getObjectStorage } from "@/lib/media/storage";
import { uuidCoordinatesEqual } from "@/lib/media/uuid-coordinate";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id, attachmentId } = await params;
  const [attachment] = await db.select({
    mediaObjectId: serviceCustomerRequestAttachments.mediaObjectId,
    bucket: serviceCustomerRequestAttachments.bucket,
    path: serviceCustomerRequestAttachments.path,
    mediaPurpose: mediaObjects.purpose,
    mediaTargetId: mediaObjects.targetId,
    mediaDomain: mediaObjects.domain,
  }).from(serviceCustomerRequestAttachments).innerJoin(
    serviceCustomerRequests,
    and(
      eq(serviceCustomerRequests.storeId, serviceCustomerRequestAttachments.storeId),
      eq(serviceCustomerRequests.id, serviceCustomerRequestAttachments.requestId),
    ),
  ).leftJoin(mediaObjects, and(
    eq(mediaObjects.storeId, serviceCustomerRequestAttachments.storeId),
    eq(mediaObjects.id, serviceCustomerRequestAttachments.mediaObjectId),
  )).where(and(
    eq(serviceCustomerRequestAttachments.id, attachmentId),
    eq(serviceCustomerRequestAttachments.requestId, id),
    eq(serviceCustomerRequestAttachments.storeId, gate.storeId),
  )).limit(1);
  if (!attachment) return mobileError("errors.notFound", 404);
  if (
    attachment.mediaObjectId
    && (
      !attachment.mediaTargetId
      || !(
        attachment.mediaPurpose === "project-document"
          && attachment.mediaDomain === "projects"
        || attachment.mediaPurpose === "service-evidence"
          && attachment.mediaDomain === "service-evidence"
      )
    )
  ) return mobileError("errors.notFound", 404);
  try {
    const url = attachment.mediaObjectId
      ? await resolveManagedPrivateMediaUrl(gate, attachment.mediaObjectId, {
        expiresInSeconds: 10 * 60,
        expectedPurpose: attachment.mediaPurpose!,
        expectedTargetId: attachment.mediaTargetId!,
        // The exact request attachment is the stable capability. Request/job
        // relinking must not rewrite or invalidate historical media identity.
        authorizeTarget: async ({ actor, purpose, targetId }) =>
          uuidCoordinatesEqual(actor.storeId, gate.storeId)
            && uuidCoordinatesEqual(actor.userId, gate.userId)
            && purpose === attachment.mediaPurpose
            && uuidCoordinatesEqual(targetId, attachment.mediaTargetId!)
            ? "allowed"
            : "not_found",
      })
      : await getObjectStorage("supabase").createDownloadUrl({
        bucket: attachment.bucket,
        key: attachment.path,
        expiresInSeconds: 10 * 60,
      });
    return mobileOk({ url, expiresIn: 600 });
  } catch (error) {
    const resolved = mediaServiceError(error);
    return mobileError(resolved.error, resolved.status);
  }
}
