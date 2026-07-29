import { createHash, randomUUID } from "node:crypto";
import { db } from "@/db";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import {
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
  searchParam,
} from "@/lib/mobile/response";
import {
  MAX_SERVICE_EVIDENCE_BYTES,
  safeServiceEvidenceName,
  SERVICE_EVIDENCE_BUCKET,
  SERVICE_EVIDENCE_MIME_TYPES,
  sniffServiceEvidenceMime,
} from "@/lib/services/evidence-storage";
import { technicianWarrantyClaimCreateSchema } from "@/lib/services/schemas";
import {
  createTechnicianWarrantyClaimCore,
  finalizeTechnicianWarrantyClaimEvidenceCore,
  listWarrantyClaimsForActorCore,
  stageServiceStorageCleanupCore,
} from "@/lib/services/technician-warranty";
import { parseTechnicianWarrantyMultipart } from "@/lib/services/technician-warranty-multipart";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function ensureEvidenceBucket() {
  const supabase = createSupabaseAdminClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  const existing = buckets.find((bucket) => bucket.name === SERVICE_EVIDENCE_BUCKET);
  const options = {
    public: false,
    fileSizeLimit: MAX_SERVICE_EVIDENCE_BYTES,
    allowedMimeTypes: [...SERVICE_EVIDENCE_MIME_TYPES],
  };
  if (!existing) {
    const { error } = await supabase.storage.createBucket(
      SERVICE_EVIDENCE_BUCKET,
      options,
    );
    if (error) throw error;
  } else if (existing.public) {
    const { error } = await supabase.storage.updateBucket(
      SERVICE_EVIDENCE_BUCKET,
      options,
    );
    if (error) throw error;
  }
  return supabase;
}

function warrantyError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "SERVICE_WARRANTY_FORBIDDEN"
    || message === "SERVICE_WARRANTY_JOB_NOT_FOUND"
  ) return mobileError("errors.notFound", 404);
  if (
    message === "SERVICE_WARRANTY_JOB_CANCELLED"
    || message === "SERVICE_WARRANTY_ASSET_MISMATCH"
  ) return mobileError("services.errors.relationMismatch", 409);
  if (message === "SERVICE_WARRANTY_INVALID") {
    return mobileError("errors.invalidData", 400);
  }
  console.error("technician warranty request failed:", error);
  return mobileError("errors.serverError", 500);
}

export async function GET(request: Request) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const jobId = (searchParam(request, "jobId", "") ?? "").trim() || null;
  return mobileOk({
    rows: await listWarrantyClaimsForActorCore(db, {
      actorId: gate.userId,
      role: gate.role,
      jobId,
    }),
  });
}

export async function POST(request: Request) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);

  const contentType = request.headers.get("content-type") ?? "";
  let raw: Record<string, unknown>;
  let file: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  } | null = null;
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    let multipart: Awaited<ReturnType<typeof parseTechnicianWarrantyMultipart>>;
    try {
      multipart = await parseTechnicianWarrantyMultipart(request);
    } catch (error) {
      return mobileError(
        "errors.invalidData",
        error instanceof Error
          && error.message === "SERVICE_WARRANTY_MULTIPART_TOO_LARGE"
          ? 413
          : 400,
      );
    }
    raw = {
      jobId: multipart.fields.jobId,
      assetId: multipart.fields.assetId,
      title: multipart.fields.title,
      description: multipart.fields.description || undefined,
      priority: multipart.fields.priority || undefined,
      scheduledAt: multipart.fields.scheduledAt || undefined,
    };
    file = multipart.file;
  } else {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return mobileError("errors.invalidData", 400);
    }
    raw = body as Record<string, unknown>;
  }

  const parsed = technicianWarrantyClaimCreateSchema.safeParse(raw);
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  const claimId = randomUUID();
  let uploaded: {
    cleanupId: string;
    path: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  } | null = null;
  try {
    if (file) {
      if (
        file.bytes.length <= 0
        || file.bytes.length > MAX_SERVICE_EVIDENCE_BYTES
        || !SERVICE_EVIDENCE_MIME_TYPES.includes(
          file.mimeType as (typeof SERVICE_EVIDENCE_MIME_TYPES)[number],
        )
      ) return mobileError("services.errors.unsupportedEvidence", 400);
      if (
        sniffServiceEvidenceMime(
          file.bytes.subarray(0, 16),
          file.mimeType,
        ) !== file.mimeType
      ) {
        return mobileError("services.errors.unsupportedEvidence", 400);
      }
      const path = `${parsed.data.jobId}/${gate.userId}/${claimId}/${safeServiceEvidenceName(file.fileName)}`;
      const [cleanup] = await db.transaction((tx) =>
        stageServiceStorageCleanupCore(tx, {
          bucket: SERVICE_EVIDENCE_BUCKET,
          path,
        }));
      uploaded = {
        cleanupId: cleanup.id,
        path,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.length,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
      };
      const supabase = await ensureEvidenceBucket();
      const { error } = await supabase.storage.from(SERVICE_EVIDENCE_BUCKET)
        .upload(uploaded.path, file.bytes, {
          contentType: file.mimeType,
          upsert: false,
        });
      if (error) throw error;
    }

    const claimInput = {
        claimId,
        actorId: gate.userId,
        jobId: parsed.data.jobId,
        assetId: parsed.data.assetId,
        title: parsed.data.title,
        description: parsed.data.description,
        priority: parsed.data.priority,
        scheduledAt: parsed.data.scheduledAt
          ? new Date(parsed.data.scheduledAt)
          : null,
      } as const;
    const claim = await db.transaction((tx) => uploaded
      ? finalizeTechnicianWarrantyClaimEvidenceCore(tx, {
        claim: claimInput,
        cleanupId: uploaded.cleanupId,
        bucket: SERVICE_EVIDENCE_BUCKET,
        path: uploaded.path,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        sha256: uploaded.sha256,
      })
      : createTechnicianWarrantyClaimCore(tx, claimInput));
    return mobileOk(claim);
  } catch (error) {
    return warrantyError(error);
  }
}
