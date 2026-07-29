import { createHash, randomUUID } from "node:crypto";
import { db } from "@/db";
import { serviceAttachments, serviceJobEvents } from "@/db/schema";
import { getFieldServiceJobDetail } from "@/lib/data/service-field";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import {
  MAX_SERVICE_EVIDENCE_BYTES,
  safeServiceEvidenceName,
  SERVICE_EVIDENCE_BUCKET,
  SERVICE_EVIDENCE_MIME_TYPES,
  sniffServiceEvidenceMime,
} from "@/lib/services/evidence-storage";
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
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function ensureEvidenceBucket() {
  const supabase = createSupabaseAdminClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  if (!buckets.some((bucket) => bucket.name === SERVICE_EVIDENCE_BUCKET)) {
    const { error } = await supabase.storage.createBucket(SERVICE_EVIDENCE_BUCKET, {
      public: false,
      fileSizeLimit: MAX_SERVICE_EVIDENCE_BYTES,
      allowedMimeTypes: [...SERVICE_EVIDENCE_MIME_TYPES],
    });
    if (error) throw error;
  }
  return supabase;
}

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
  const safeName = safeServiceEvidenceName(file.name);
  const path = `${detail.projectId}/${id}/${gate.userId}/${Date.now()}-${randomUUID()}-${safeName}`;

  try {
    const supabase = await ensureEvidenceBucket();
    const { error: uploadError } = await supabase.storage
      .from(SERVICE_EVIDENCE_BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    try {
      const [attachment] = await db.transaction(async (tx) => {
        await requireLockedServiceJobAccess(tx, {
          userId: gate.userId,
          role: gate.role,
        }, id);
        const rows = await tx.insert(serviceAttachments).values({
          projectId: detail.projectId,
          jobId: id,
          category: parsed.data.category,
          bucket: SERVICE_EVIDENCE_BUCKET,
          path,
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
      await supabase.storage.from(SERVICE_EVIDENCE_BUCKET).remove([path]);
      throw error;
    }
  } catch (error) {
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
  const supabase = createSupabaseAdminClient();
  return mobileFieldOperation(async () => {
    const result = await db.transaction((tx) => deleteServiceEvidenceCore(tx, {
      userId: gate.userId,
      role: gate.role,
    }, { jobId: id, attachmentId }));
    if (result.storagePending) await completeServiceEvidenceStorageRemoval(db, {
    async remove(bucket, path) {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) throw error;
    },
    }, { jobId: id, attachmentId });
    return { id: result.id };
  });
}
