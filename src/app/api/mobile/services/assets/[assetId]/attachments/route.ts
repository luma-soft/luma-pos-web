import { createHash } from "node:crypto";
import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { installedAssets, serviceAttachments } from "@/db/schema";
import type { MediaActor } from "@/lib/media/authorization";
import {
  compensateManagedMediaAssociation,
  requireReadyManagedMediaInTransaction,
  resolveManagedPrivateMediaUrl,
} from "@/lib/media/project-media";
import { getMediaService } from "@/lib/media/service";
import { getObjectStorage } from "@/lib/media/storage";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import {
  serviceEvidenceDeclaredMime,
  sniffServiceEvidenceMime,
} from "@/lib/services/evidence-storage";
import { serviceAssetAttachmentMetadataSchema } from "@/lib/services/schemas";

async function loadAsset(storeId: string, assetId: string) {
  const [asset] = await db.select({
    id: installedAssets.id,
    projectId: installedAssets.projectId,
    jobId: installedAssets.jobId,
  }).from(installedAssets).where(and(
    eq(installedAssets.storeId, storeId),
    eq(installedAssets.id, assetId),
  )).limit(1);
  return asset ?? null;
}

type AssetAttachmentStorage = {
  mediaObjectId: string | null;
  bucket: string;
  path: string;
};

async function resolveAssetAttachmentUrl(
  actor: MediaActor,
  attachment: AssetAttachmentStorage,
  target: {
    purpose: "service-evidence" | "project-document";
    targetId: string;
  },
) {
  if (attachment.mediaObjectId) {
    return resolveManagedPrivateMediaUrl(actor, attachment.mediaObjectId, {
      expiresInSeconds: 15 * 60,
      expectedPurpose: target.purpose,
      expectedTargetId: target.targetId,
    });
  }
  return getObjectStorage("supabase").createDownloadUrl({
    bucket: attachment.bucket,
    key: attachment.path,
    expiresInSeconds: 15 * 60,
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { assetId } = await params;
  const asset = await loadAsset(gate.storeId, assetId);
  if (!asset) return mobileError("errors.notFound", 404);

  const attachments = await db.select({
    id: serviceAttachments.id,
    mediaObjectId: serviceAttachments.mediaObjectId,
    bucket: serviceAttachments.bucket,
    path: serviceAttachments.path,
    fileName: serviceAttachments.fileName,
    mimeType: serviceAttachments.mimeType,
    sizeBytes: serviceAttachments.sizeBytes,
    sortOrder: serviceAttachments.sortOrder,
    isPrimary: serviceAttachments.isPrimary,
    createdAt: serviceAttachments.createdAt,
  }).from(serviceAttachments).where(and(
    eq(serviceAttachments.storeId, gate.storeId),
    eq(serviceAttachments.assetId, assetId),
    eq(serviceAttachments.category, "asset"),
    isNull(serviceAttachments.deletedAt),
  )).orderBy(asc(serviceAttachments.sortOrder), asc(serviceAttachments.createdAt));
  const mediaTarget = {
    purpose: "project-document" as const,
    targetId: asset.projectId,
  };

  const data = await Promise.all(attachments.map(async (attachment) => {
    const signedUrl = await resolveAssetAttachmentUrl(gate, attachment, mediaTarget);
    return {
      id: attachment.id,
      bucket: attachment.bucket,
      path: attachment.path,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sortOrder: attachment.sortOrder,
      isPrimary: attachment.isPrimary,
      createdAt: attachment.createdAt,
      signedUrl,
    };
  }));
  return mobileOk(data);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { assetId } = await params;
  const asset = await loadAsset(gate.storeId, assetId);
  if (!asset) return mobileError("errors.notFound", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return mobileError("errors.invalidData", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return mobileError("errors.invalidData", 400);
  const declaredMime = serviceEvidenceDeclaredMime(file.name, file.type);
  const parsed = serviceAssetAttachmentMetadataSchema.safeParse({
    assetId,
    category: "asset",
    fileName: file.name,
    mimeType: declaredMime,
    sizeBytes: file.size,
    clientRequestId: form.get("clientRequestId"),
    sortOrder: form.get("sortOrder") ?? 0,
    isPrimary: form.get("isPrimary") === "true",
    caption: form.get("caption") || undefined,
  });
  if (!parsed.success) return mobileError("errors.invalidData", 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedMime = sniffServiceEvidenceMime(bytes.subarray(0, 16), declaredMime);
  if (!detectedMime || detectedMime !== declaredMime) {
    return mobileError("services.errors.unsupportedEvidence", 400);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Asset photos are an immutable project-owned coordinate. The asset's job
  // assignment is editable and therefore cannot be part of media identity.
  const purpose = "project-document" as const;
  const targetId = asset.projectId;

  try {
    const [existing] = await db.select({
      id: serviceAttachments.id,
      mediaObjectId: serviceAttachments.mediaObjectId,
      bucket: serviceAttachments.bucket,
      path: serviceAttachments.path,
      fileName: serviceAttachments.fileName,
      mimeType: serviceAttachments.mimeType,
      sizeBytes: serviceAttachments.sizeBytes,
      sortOrder: serviceAttachments.sortOrder,
      isPrimary: serviceAttachments.isPrimary,
      createdAt: serviceAttachments.createdAt,
    }).from(serviceAttachments).where(and(
      eq(serviceAttachments.storeId, gate.storeId),
      eq(serviceAttachments.assetId, assetId),
      eq(serviceAttachments.clientRequestId, parsed.data.clientRequestId),
      eq(serviceAttachments.category, "asset"),
      isNull(serviceAttachments.deletedAt),
    )).limit(1);
    if (existing) {
      const signedUrl = await resolveAssetAttachmentUrl(gate, existing, {
        purpose,
        targetId,
      });
      return mobileOk({
        id: existing.id,
        fileName: existing.fileName,
        mimeType: existing.mimeType,
        sizeBytes: existing.sizeBytes,
        sortOrder: existing.sortOrder,
        isPrimary: existing.isPrimary,
        createdAt: existing.createdAt,
        signedUrl,
      });
    }
    const managed = await getMediaService().putManagedObject(gate, {
      purpose,
      targetId,
      fileName: file.name,
      mimeType: detectedMime,
      sizeBytes: file.size,
    }, bytes);
    let attachment: {
      id: string;
      mediaObjectId: string | null;
      bucket: string;
      path: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      sortOrder: number;
      isPrimary: boolean;
      createdAt: Date;
    };
    try {
      [attachment] = await db.transaction(async (tx) => {
        const [lockedAsset] = await tx.select({
          id: installedAssets.id,
          projectId: installedAssets.projectId,
          jobId: installedAssets.jobId,
        }).from(installedAssets).where(and(
          eq(installedAssets.storeId, gate.storeId),
          eq(installedAssets.id, assetId),
        )).limit(1).for("update");
        if (
          !lockedAsset
          || lockedAsset.projectId !== asset.projectId
          || lockedAsset.jobId !== asset.jobId
        ) throw new Error("SERVICE_ASSET_NOT_FOUND");

        let [persisted] = await tx.select({
          id: serviceAttachments.id,
          mediaObjectId: serviceAttachments.mediaObjectId,
          bucket: serviceAttachments.bucket,
          path: serviceAttachments.path,
          fileName: serviceAttachments.fileName,
          mimeType: serviceAttachments.mimeType,
          sizeBytes: serviceAttachments.sizeBytes,
          sortOrder: serviceAttachments.sortOrder,
          isPrimary: serviceAttachments.isPrimary,
          createdAt: serviceAttachments.createdAt,
        }).from(serviceAttachments).where(and(
          eq(serviceAttachments.storeId, gate.storeId),
          eq(serviceAttachments.assetId, assetId),
          eq(serviceAttachments.clientRequestId, parsed.data.clientRequestId),
          eq(serviceAttachments.category, "asset"),
          isNull(serviceAttachments.deletedAt),
        )).limit(1);

        if (!persisted) {
          const [{ total }] = await tx.select({
            total: count(serviceAttachments.id),
          }).from(serviceAttachments).where(and(
            eq(serviceAttachments.storeId, gate.storeId),
            eq(serviceAttachments.assetId, assetId),
            eq(serviceAttachments.category, "asset"),
            isNull(serviceAttachments.deletedAt),
          ));
          if (Number(total) >= 8) {
            throw new Error("SERVICE_ASSET_PHOTO_LIMIT");
          }

          const media = await requireReadyManagedMediaInTransaction(tx, {
            storeId: gate.storeId,
            mediaId: managed.mediaId,
            purpose,
            targetId,
            expectedPath: managed.path,
            sha256,
            mimeType: detectedMime,
            sizeBytes: file.size,
            fileName: file.name,
          });
          await tx.insert(serviceAttachments).values({
            storeId: gate.storeId,
            projectId: asset.projectId,
            assetId,
            mediaObjectId: media.id,
            category: "asset",
            bucket: media.bucket,
            path: media.objectKey,
            fileName: file.name,
            mimeType: detectedMime,
            sizeBytes: file.size,
            sha256,
            clientRequestId: parsed.data.clientRequestId,
            sortOrder: parsed.data.sortOrder,
            isPrimary: false,
            caption: parsed.data.caption || null,
            createdBy: gate.userId,
          }).onConflictDoNothing();
          [persisted] = await tx.select({
            id: serviceAttachments.id,
            mediaObjectId: serviceAttachments.mediaObjectId,
            bucket: serviceAttachments.bucket,
            path: serviceAttachments.path,
            fileName: serviceAttachments.fileName,
            mimeType: serviceAttachments.mimeType,
            sizeBytes: serviceAttachments.sizeBytes,
            sortOrder: serviceAttachments.sortOrder,
            isPrimary: serviceAttachments.isPrimary,
            createdAt: serviceAttachments.createdAt,
          }).from(serviceAttachments).where(and(
            eq(serviceAttachments.storeId, gate.storeId),
            eq(serviceAttachments.assetId, assetId),
            eq(serviceAttachments.clientRequestId, parsed.data.clientRequestId),
            eq(serviceAttachments.category, "asset"),
            isNull(serviceAttachments.deletedAt),
          )).limit(1);
        }
        if (!persisted) throw new Error("SERVICE_ASSET_ATTACHMENT_IDEMPOTENCY_CONFLICT");
        if (parsed.data.isPrimary) {
          await tx.update(serviceAttachments).set({ isPrimary: false }).where(and(
            eq(serviceAttachments.storeId, gate.storeId),
            eq(serviceAttachments.assetId, assetId),
            ne(serviceAttachments.id, persisted.id),
            eq(serviceAttachments.category, "asset"),
            isNull(serviceAttachments.deletedAt),
          ));
          await tx.update(serviceAttachments).set({ isPrimary: true }).where(eq(serviceAttachments.id, persisted.id));
          persisted.isPrimary = true;
         }
         return [persisted];
       });
    } catch (error) {
      await compensateManagedMediaAssociation(db, {
        storeId: gate.storeId,
        mediaId: managed.mediaId,
        purpose,
        targetId,
      });
      throw error;
    }
    if (attachment.mediaObjectId !== managed.mediaId) {
      await compensateManagedMediaAssociation(db, {
        storeId: gate.storeId,
        mediaId: managed.mediaId,
        purpose,
        targetId,
      });
    }
    const signedUrl = await resolveAssetAttachmentUrl(gate, attachment, {
      purpose,
      targetId,
    });
    return mobileOk({
      id: attachment.id,
      path: attachment.path,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sortOrder: attachment.sortOrder,
      isPrimary: attachment.isPrimary,
      createdAt: attachment.createdAt,
      signedUrl,
    });
  } catch (error) {
    console.error("installed asset photo upload failed:", error);
    if (error instanceof Error && error.message === "SERVICE_ASSET_PHOTO_LIMIT") {
      return mobileError("errors.invalidData", 409);
    }
    return mobileError("errors.serverError", 500);
  }
}
