import { createHash } from "node:crypto";
import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { installedAssets, serviceAttachments } from "@/db/schema";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { ensureServiceEvidenceBucket } from "@/lib/services/evidence-bucket";
import {
  safeServiceEvidenceName,
  SERVICE_EVIDENCE_BUCKET,
  serviceEvidenceDeclaredMime,
  sniffServiceEvidenceMime,
} from "@/lib/services/evidence-storage";
import { serviceAssetAttachmentMetadataSchema } from "@/lib/services/schemas";

async function loadAsset(storeId: string, assetId: string) {
  const [asset] = await db.select({
    id: installedAssets.id,
    projectId: installedAssets.projectId,
  }).from(installedAssets).where(and(
    eq(installedAssets.storeId, storeId),
    eq(installedAssets.id, assetId),
  )).limit(1);
  return asset ?? null;
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

  const supabase = await ensureServiceEvidenceBucket();
  const data = await Promise.all(attachments.map(async (attachment) => {
    const { data: signed, error } = await supabase.storage
      .from(attachment.bucket)
      .createSignedUrl(attachment.path, 15 * 60);
    if (error) throw error;
    return { ...attachment, signedUrl: signed.signedUrl };
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
  const safeName = safeServiceEvidenceName(file.name);
  const safeRequestId = safeServiceEvidenceName(parsed.data.clientRequestId);
  const path = `stores/${gate.storeId}/services/assets/${assetId}/${gate.userId}/${safeRequestId}-${sha256.slice(0, 16)}-${safeName}`;

  try {
    const supabase = await ensureServiceEvidenceBucket();
    const [existing] = await db.select({
      id: serviceAttachments.id,
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
      const { data: signed, error: signedError } = await supabase.storage
        .from(SERVICE_EVIDENCE_BUCKET)
        .createSignedUrl(existing.path, 15 * 60);
      if (signedError) throw signedError;
      return mobileOk({
        id: existing.id,
        fileName: existing.fileName,
        mimeType: existing.mimeType,
        sizeBytes: existing.sizeBytes,
        sortOrder: existing.sortOrder,
        isPrimary: existing.isPrimary,
        createdAt: existing.createdAt,
        signedUrl: signed.signedUrl,
      });
    }
    const { error: uploadError } = await supabase.storage
      .from(SERVICE_EVIDENCE_BUCKET)
      .upload(path, bytes, { contentType: detectedMime, upsert: true });
    if (uploadError) throw uploadError;
    try {
      const [attachment] = await db.transaction(async (tx) => {
        await tx.select({ id: installedAssets.id }).from(installedAssets).where(and(
          eq(installedAssets.storeId, gate.storeId),
          eq(installedAssets.id, assetId),
        )).limit(1).for("update");

        let [persisted] = await tx.select({
          id: serviceAttachments.id,
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

          await tx.insert(serviceAttachments).values({
            storeId: gate.storeId,
            projectId: asset.projectId,
            assetId,
            category: "asset",
            bucket: SERVICE_EVIDENCE_BUCKET,
            path,
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
       if (attachment.path !== path) {
         await supabase.storage.from(SERVICE_EVIDENCE_BUCKET).remove([path]);
       }
       const { data: signed, error: signedError } = await supabase.storage
        .from(SERVICE_EVIDENCE_BUCKET)
        .createSignedUrl(attachment.path, 15 * 60);
      if (signedError) throw signedError;
      return mobileOk({ ...attachment, signedUrl: signed.signedUrl });
    } catch (error) {
      await supabase.storage.from(SERVICE_EVIDENCE_BUCKET).remove([path]);
      throw error;
    }
  } catch (error) {
    console.error("installed asset photo upload failed:", error);
    if (error instanceof Error && error.message === "SERVICE_ASSET_PHOTO_LIMIT") {
      return mobileError("errors.invalidData", 409);
    }
    return mobileError("errors.serverError", 500);
  }
}
