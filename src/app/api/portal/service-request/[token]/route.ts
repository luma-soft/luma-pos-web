import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  serviceCustomerRequestAttachments,
  serviceCustomerRequests,
  serviceSlaPolicies,
  storeFeatures,
} from "@/db/schema";
import { getR2Config } from "@/lib/media/config";
import {
  compensateManagedMediaAssociation,
  createDatabaseMediaRepository,
  requireReadyManagedMediaInTransaction,
} from "@/lib/media/project-media";
import { createMediaService } from "@/lib/media/service";
import { getObjectStorage } from "@/lib/media/storage";
import { mobileError, mobileOk } from "@/lib/mobile/response";
import {
  consumePublicRateLimitCore,
  sanitizeCustomerRequestEvidence,
  submitCustomerRequestCore,
} from "@/lib/services/customer-request-portal";
import {
  hashCustomerRequestToken,
  isCustomerRequestTokenSubmittable,
  isCustomerRequestTokenViewable,
} from "@/lib/services/customer-request-token";
import { serviceCustomerRequestSubmitSchema } from "@/lib/services/schemas";
import { parseCustomerRequestMultipart } from "@/lib/services/customer-request-multipart";
import { CURRENT_STORE_FEATURE_DEFAULTS } from "@/lib/tenancy/store-features";

const PORTAL_MEDIA_ACTOR_ID = "00000000-0000-4000-8000-000000000000";

async function consumeLimit(input: { key: string; limit: number; windowSeconds: number }) {
  return db.transaction((tx) => consumePublicRateLimitCore(tx, input));
}

function limited(result: { allowed: boolean; retryAfterSeconds: number }) {
  if (result.allowed) return null;
  return Response.json(
    { ok: false, error: "errors.rateLimited" },
    { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
  );
}

function createPortalMediaCapability(storeId: string, projectId: string) {
  const actor = {
    storeId,
    userId: PORTAL_MEDIA_ACTOR_ID,
    role: "manager" as const,
    features: CURRENT_STORE_FEATURE_DEFAULTS,
  };
  const mediaService = createMediaService({
    storage: getObjectStorage("r2"),
    repository: createDatabaseMediaRepository(db, { forceCreatedByNull: true }),
    config: getR2Config(),
    authorizeTarget: async ({ actor: candidate, purpose, targetId }) =>
      candidate.storeId === storeId
        && candidate.userId === PORTAL_MEDIA_ACTOR_ID
        && purpose === "project-document"
        && targetId === projectId
        ? "allowed"
        : "not_found",
  });
  return { actor, mediaService };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const globalBlocked = limited(await consumeLimit({
    key: "customer-request:get:global",
    limit: 10_000,
    windowSeconds: 60,
  }));
  if (globalBlocked) return globalBlocked;
  const { token } = await params;
  if (token.length < 40) return mobileError("errors.notFound", 404);
  const tokenHash = hashCustomerRequestToken(token);
  const [row] = await db.select({
    code: serviceCustomerRequests.code,
    projectName: projects.name,
    title: serviceCustomerRequests.title,
    priority: serviceCustomerRequests.priority,
    status: serviceCustomerRequests.status,
    submittedAt: serviceCustomerRequests.submittedAt,
    responseDueAt: serviceCustomerRequests.responseDueAt,
    resolutionDueAt: serviceCustomerRequests.resolutionDueAt,
    respondedAt: serviceCustomerRequests.respondedAt,
    resolvedAt: serviceCustomerRequests.resolvedAt,
    tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
  }).from(serviceCustomerRequests)
    .innerJoin(projects, eq(serviceCustomerRequests.projectId, projects.id))
    .innerJoin(storeFeatures, and(
      eq(storeFeatures.storeId, serviceCustomerRequests.storeId),
      eq(storeFeatures.featureKey, "field_services"),
      eq(storeFeatures.enabled, true),
    ))
    .where(eq(serviceCustomerRequests.tokenHash, tokenHash))
    .limit(1);
  if (!row || !isCustomerRequestTokenViewable({ expiresAt: row.tokenExpiresAt })) {
    return mobileError("errors.notFound", 404);
  }
  const tokenBlocked = limited(await consumeLimit({
    key: `customer-request:get:token:${tokenHash}`,
    limit: 60,
    windowSeconds: 3600,
  }));
  if (tokenBlocked) return tokenBlocked;
  return mobileOk({
    code: row.code,
    projectName: row.projectName,
    title: row.submittedAt ? row.title : null,
    priority: row.submittedAt ? row.priority : null,
    status: row.status,
    submittedAt: row.submittedAt,
    responseDueAt: row.responseDueAt,
    resolutionDueAt: row.resolutionDueAt,
    respondedAt: row.respondedAt,
    resolvedAt: row.resolvedAt,
    canSubmit: isCustomerRequestTokenSubmittable({
      status: row.status,
      submittedAt: row.submittedAt,
      expiresAt: row.tokenExpiresAt,
    }),
    expiresAt: row.tokenExpiresAt,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const globalBlocked = limited(await consumeLimit({
    key: "customer-request:submit:global",
    limit: 1_000,
    windowSeconds: 60,
  }));
  if (globalBlocked) return globalBlocked;
  const { token } = await params;
  if (token.length < 40) return mobileError("errors.notFound", 404);
  const tokenHash = hashCustomerRequestToken(token);
  const [current] = await db.select({
    id: serviceCustomerRequests.id,
    storeId: serviceCustomerRequests.storeId,
    projectId: serviceCustomerRequests.projectId,
    status: serviceCustomerRequests.status,
    submittedAt: serviceCustomerRequests.submittedAt,
    tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
  }).from(serviceCustomerRequests)
    .innerJoin(storeFeatures, and(
      eq(storeFeatures.storeId, serviceCustomerRequests.storeId),
      eq(storeFeatures.featureKey, "field_services"),
      eq(storeFeatures.enabled, true),
    ))
    .where(eq(serviceCustomerRequests.tokenHash, tokenHash))
    .limit(1);
  if (!current || !isCustomerRequestTokenSubmittable({
    status: current.status,
    submittedAt: current.submittedAt,
    expiresAt: current.tokenExpiresAt,
  })) return mobileError("errors.notFound", 404);
  const tokenBlocked = limited(await consumeLimit({
    key: `customer-request:submit:token:${tokenHash}`,
    limit: 10,
    windowSeconds: 900,
  }));
  if (tokenBlocked) return tokenBlocked;
  let multipart: Awaited<ReturnType<typeof parseCustomerRequestMultipart>>;
  try {
    multipart = await parseCustomerRequestMultipart(request);
  } catch (error) {
    return mobileError(
      "errors.invalidData",
      error instanceof Error && error.message === "CUSTOMER_REQUEST_MULTIPART_TOO_LARGE"
        ? 413
        : 400,
    );
  }
  const parsed = serviceCustomerRequestSubmitSchema.safeParse(multipart.fields);
  if (!parsed.success) return mobileError("errors.invalidData", 400);
  const sanitized: Array<{
    file: (typeof multipart.files)[number];
    image: NonNullable<Awaited<ReturnType<typeof sanitizeCustomerRequestEvidence>>>;
  }> = [];
  for (const file of multipart.files) {
    const image = await sanitizeCustomerRequestEvidence({
      bytes: file.bytes,
      declaredMimeType: file.mimeType,
      fileName: file.fileName,
    });
    if (!image) return mobileError("services.errors.unsupportedEvidence", 400);
    sanitized.push({ file, image });
  }
  const [policy] = await db.select({
    responseMinutes: serviceSlaPolicies.responseMinutes,
    resolutionMinutes: serviceSlaPolicies.resolutionMinutes,
  }).from(serviceSlaPolicies).where(and(
    eq(serviceSlaPolicies.storeId, current.storeId),
    eq(serviceSlaPolicies.priority, parsed.data.priority),
    eq(serviceSlaPolicies.isActive, true),
  )).limit(1);
  const now = new Date();
  if (sanitized.length === 0) {
    try {
      const result = await db.transaction((tx) => submitCustomerRequestCore(tx, {
        requestId: current.id,
        ...parsed.data,
        now,
        responseMinutes: policy?.responseMinutes ?? null,
        resolutionMinutes: policy?.resolutionMinutes ?? null,
      }));
      return mobileOk({
        code: result.code,
        status: result.status,
        responseDueAt: result.responseDueAt,
        resolutionDueAt: result.resolutionDueAt,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CUSTOMER_REQUEST_NOT_SUBMITTABLE") {
        return mobileError("errors.notFound", 404);
      }
      return mobileError("errors.serverError", 500);
    }
  }
  const uploaded: Array<{
    mediaId: string;
    path: string;
    fileName: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    sizeBytes: number;
    width: number;
    height: number;
    sha256: string;
  }> = [];
  try {
    const { actor, mediaService } = createPortalMediaCapability(
      current.storeId,
      current.projectId,
    );
    for (const item of sanitized) {
      const fileName = item.file.fileName
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .slice(0, 200);
      const managed = await mediaService.putManagedObject(actor, {
        purpose: "project-document",
        targetId: current.projectId,
        fileName,
        mimeType: item.image.mimeType,
        sizeBytes: item.image.bytes.length,
      }, item.image.bytes);
      uploaded.push({
        mediaId: managed.mediaId,
        path: managed.path,
        fileName,
        mimeType: item.image.mimeType,
        sizeBytes: item.image.bytes.length,
        width: item.image.width,
        height: item.image.height,
        sha256: item.image.sha256,
      });
    }
    const result = await db.transaction(async (tx) => {
      const submitted = await submitCustomerRequestCore(tx, {
        requestId: current.id,
        ...parsed.data,
        now,
        responseMinutes: policy?.responseMinutes ?? null,
        resolutionMinutes: policy?.resolutionMinutes ?? null,
      });
      const attachments = [];
      for (const object of uploaded) {
        const media = await requireReadyManagedMediaInTransaction(tx, {
          storeId: current.storeId,
          mediaId: object.mediaId,
          purpose: "project-document",
          targetId: current.projectId,
          expectedPath: object.path,
          sha256: object.sha256,
          width: object.width,
          height: object.height,
          mimeType: object.mimeType,
          sizeBytes: object.sizeBytes,
          fileName: object.fileName,
        });
        attachments.push({
          storeId: current.storeId,
          requestId: current.id,
          mediaObjectId: media.id,
          bucket: media.bucket,
          path: media.objectKey,
          fileName: object.fileName,
          mimeType: object.mimeType,
          sizeBytes: object.sizeBytes,
          width: object.width,
          height: object.height,
          sha256: object.sha256,
        });
      }
      await tx.insert(serviceCustomerRequestAttachments).values(attachments);
      return submitted;
    });
    return mobileOk({
      code: result.code,
      status: result.status,
      responseDueAt: result.responseDueAt,
      resolutionDueAt: result.resolutionDueAt,
    });
  } catch (error) {
    for (const object of uploaded) {
      try {
        await compensateManagedMediaAssociation(db, {
          storeId: current.storeId,
          mediaId: object.mediaId,
          purpose: "project-document",
          targetId: current.projectId,
        });
      } catch (compensationError) {
        console.error("customer request media compensation failed", {
          requestId: current.id,
          mediaId: object.mediaId,
          error: compensationError instanceof Error
            ? compensationError.message
            : "unknown",
        });
      }
    }
    if (error instanceof Error && error.message === "CUSTOMER_REQUEST_NOT_SUBMITTABLE") {
      return mobileError("errors.notFound", 404);
    }
    console.error("customer request atomic submit failed", {
      requestId: current.id,
      uploadedCount: uploaded.length,
      error: error instanceof Error ? error.message : "unknown",
    });
    return mobileError("errors.serverError", 500);
  }
}
