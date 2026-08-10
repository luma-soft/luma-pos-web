import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, serviceCustomerRequests, serviceSlaPolicies, storeFeatures } from "@/db/schema";
import { mobileError, mobileOk } from "@/lib/mobile/response";
import {
  consumePublicRateLimitCore,
  CUSTOMER_REQUEST_EVIDENCE_BUCKET,
  CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES,
  CUSTOMER_REQUEST_EVIDENCE_MIME_TYPES,
  sanitizeCustomerRequestEvidence,
  stageCustomerRequestStorageCleanupCore,
  submitCustomerRequestCore,
} from "@/lib/services/customer-request-portal";
import {
  hashCustomerRequestToken,
  isCustomerRequestTokenSubmittable,
  isCustomerRequestTokenViewable,
} from "@/lib/services/customer-request-token";
import { serviceCustomerRequestSubmitSchema } from "@/lib/services/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseCustomerRequestMultipart } from "@/lib/services/customer-request-multipart";

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

async function ensurePrivateBucket() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const existing = data.find((bucket) => bucket.name === CUSTOMER_REQUEST_EVIDENCE_BUCKET);
  const options = {
    public: false,
    fileSizeLimit: CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES,
    allowedMimeTypes: [...CUSTOMER_REQUEST_EVIDENCE_MIME_TYPES],
  };
  if (!existing) {
    const { error: createError } = await supabase.storage.createBucket(
      CUSTOMER_REQUEST_EVIDENCE_BUCKET,
      options,
    );
    if (createError) throw createError;
  } else if (existing.public) {
    const { error: updateError } = await supabase.storage.updateBucket(
      CUSTOMER_REQUEST_EVIDENCE_BUCKET,
      options,
    );
    if (updateError) throw updateError;
  }
  return supabase;
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
  const objects = sanitized.map(({ image }) => ({
    bucket: CUSTOMER_REQUEST_EVIDENCE_BUCKET,
    path: `${current.id}/${now.getTime()}-${randomUUID()}.${image.extension}`,
  }));
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
  let staged: Awaited<ReturnType<typeof stageCustomerRequestStorageCleanupCore>> = [];
  try {
    const supabase = await ensurePrivateBucket();
    staged = await db.transaction((tx) => stageCustomerRequestStorageCleanupCore(tx, {
      requestId: current.id,
      objects,
      now,
    }));
    for (let index = 0; index < sanitized.length; index++) {
      const item = sanitized[index];
      const object = staged[index];
      const { error } = await supabase.storage.from(object.bucket).upload(
        object.path,
        item.image.bytes,
        { contentType: item.image.mimeType, upsert: false },
      );
      if (error) throw error;
    }
    const result = await db.transaction((tx) => submitCustomerRequestCore(tx, {
      requestId: current.id,
      ...parsed.data,
      now,
      responseMinutes: policy?.responseMinutes ?? null,
      resolutionMinutes: policy?.resolutionMinutes ?? null,
      attachments: sanitized.map((item, index) => ({
        cleanupId: staged[index].id,
        bucket: staged[index].bucket,
        path: staged[index].path,
        fileName: item.file.fileName.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 200),
        mimeType: item.image.mimeType,
        sizeBytes: item.image.bytes.length,
        width: item.image.width,
        height: item.image.height,
        sha256: item.image.sha256,
      })),
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
    console.error("customer request atomic submit failed", {
      requestId: current.id,
      stagedCount: staged.length,
      error: error instanceof Error ? error.message : "unknown",
    });
    return mobileError("errors.serverError", 500);
  }
}
