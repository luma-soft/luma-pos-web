import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  serviceAttachments,
  serviceJobs,
  warrantyClaims,
} from "@/db/schema";
import {
  compensateManagedMediaAssociation,
  requireReadyManagedMediaInTransaction,
} from "@/lib/media/project-media";
import { getMediaService, mediaServiceError } from "@/lib/media/service";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import {
  mobileError,
  mobileGate,
  mobileOk,
  readJson,
  searchParam,
} from "@/lib/mobile/response";
import {
  safeServiceEvidenceName,
} from "@/lib/services/evidence-storage";
import { technicianWarrantyClaimCreateSchema } from "@/lib/services/schemas";
import {
  createTechnicianWarrantyClaimCore,
  listWarrantyClaimsForActorCore,
  sanitizeTechnicianWarrantyEvidence,
} from "@/lib/services/technician-warranty";
import { parseTechnicianWarrantyMultipart } from "@/lib/services/technician-warranty-multipart";

function warrantyError(error: unknown) {
  const managedError = mediaServiceError(error);
  if (managedError.status === 403 || managedError.status === 404) {
    return mobileError("errors.notFound", 404);
  }
  if (managedError.status !== 500) {
    return mobileError(managedError.error, managedError.status);
  }
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
  const rows = await listWarrantyClaimsForActorCore(db, {
    actorId: gate.userId,
    role: gate.role,
    jobId,
  });
  const owned = rows.length === 0
    ? []
    : await db.select({ id: warrantyClaims.id }).from(warrantyClaims).where(and(
      eq(warrantyClaims.storeId, gate.storeId),
      inArray(warrantyClaims.id, rows.map((row) => row.id)),
    ));
  const ownedIds = new Set(owned.map((row) => row.id));
  return mobileOk({ rows: rows.filter((row) => ownedIds.has(row.id)) });
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
    mediaId: string;
    path: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    width: number;
    height: number;
  } | null = null;
  try {
    if (file) {
      const image = await sanitizeTechnicianWarrantyEvidence({
        bytes: file.bytes,
        declaredMimeType: file.mimeType,
        fileName: file.fileName,
      });
      if (!image) return mobileError("services.errors.unsupportedEvidence", 400);
      const baseName = safeServiceEvidenceName(
        file.fileName.replace(/\.[^.]+$/, ""),
      );
      const canonicalName = `${baseName}.${image.extension}`;
      const managed = await getMediaService().putManagedObject(gate, {
        purpose: "service-evidence",
        targetId: parsed.data.jobId,
        fileName: canonicalName,
        mimeType: image.mimeType,
        sizeBytes: image.bytes.length,
      }, image.bytes);
      uploaded = {
        mediaId: managed.mediaId,
        path: managed.path,
        fileName: canonicalName,
        mimeType: image.mimeType,
        sizeBytes: image.bytes.length,
        sha256: image.sha256,
        width: image.width,
        height: image.height,
      };
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
    let claim;
    try {
      claim = await db.transaction(async (tx) => {
        const [ownedJob] = await tx.select({ id: serviceJobs.id })
          .from(serviceJobs).where(and(
            eq(serviceJobs.storeId, gate.storeId),
            eq(serviceJobs.id, parsed.data.jobId),
          )).limit(1);
        if (!ownedJob) throw new Error("SERVICE_WARRANTY_JOB_NOT_FOUND");
        const created = await createTechnicianWarrantyClaimCore(tx, claimInput);
        if (!uploaded) return created;
        const media = await requireReadyManagedMediaInTransaction(tx, {
          storeId: gate.storeId,
          mediaId: uploaded.mediaId,
          purpose: "service-evidence",
          targetId: parsed.data.jobId,
          expectedPath: uploaded.path,
          sha256: uploaded.sha256,
          width: uploaded.width,
          height: uploaded.height,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          fileName: uploaded.fileName,
        });
        await tx.insert(serviceAttachments).values({
          storeId: gate.storeId,
          projectId: created.projectId,
          jobId: created.jobId,
          claimId: created.id,
          assetId: created.assetId,
          mediaObjectId: media.id,
          category: "issue",
          bucket: media.bucket,
          path: media.objectKey,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          sha256: uploaded.sha256,
          createdBy: gate.userId,
        });
        return created;
      });
    } catch (error) {
      if (uploaded) {
        await compensateManagedMediaAssociation(db, {
          storeId: gate.storeId,
          mediaId: uploaded.mediaId,
          purpose: "service-evidence",
          targetId: parsed.data.jobId,
        });
      }
      throw error;
    }
    return mobileOk(claim);
  } catch (error) {
    return warrantyError(error);
  }
}
