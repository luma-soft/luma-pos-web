import { createHash, randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  serviceCustomerRequestAttachments,
  serviceCustomerRequests,
} from "@/db/schema";
import { mobileError, mobileOk } from "@/lib/mobile/response";
import {
  consumePublicRateLimitCore,
  CUSTOMER_REQUEST_EVIDENCE_BUCKET,
  CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES,
  CUSTOMER_REQUEST_EVIDENCE_MIME_TYPES,
  sniffCustomerRequestEvidence,
} from "@/lib/services/customer-request-portal";
import {
  hashCustomerRequestToken,
  isCustomerRequestTokenSubmittable,
} from "@/lib/services/customer-request-token";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (token.length < 40) return mobileError("errors.notFound", 404);
  const tokenHash = hashCustomerRequestToken(token);
  const limited = await db.transaction((tx) => consumePublicRateLimitCore(tx, {
    key: `customer-request:upload:${tokenHash}`,
    limit: 6,
    windowSeconds: 900,
  }));
  if (!limited.allowed) {
    return Response.json(
      { ok: false, error: "errors.rateLimited" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength)
    && contentLength > CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES + 128 * 1024
  ) return mobileError("errors.invalidData", 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return mobileError("errors.invalidData", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES) {
    return mobileError("errors.invalidData", 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = sniffCustomerRequestEvidence(bytes);
  if (!detected) return mobileError("services.errors.unsupportedEvidence", 400);
  const [current] = await db.select({
    id: serviceCustomerRequests.id,
    status: serviceCustomerRequests.status,
    submittedAt: serviceCustomerRequests.submittedAt,
    tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
  }).from(serviceCustomerRequests)
    .where(eq(serviceCustomerRequests.tokenHash, tokenHash))
    .limit(1);
  if (!current || !isCustomerRequestTokenSubmittable({
    status: current.status,
    submittedAt: current.submittedAt,
    expiresAt: current.tokenExpiresAt,
  })) return mobileError("errors.notFound", 404);
  const [existing] = await db.select({ value: count() })
    .from(serviceCustomerRequestAttachments)
    .where(eq(serviceCustomerRequestAttachments.requestId, current.id));
  if (existing.value >= 3) return mobileError("errors.invalidData", 400);
  const path = `${current.id}/${Date.now()}-${randomUUID()}.${detected.extension}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const safeName = file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 200) || `evidence.${detected.extension}`;
  const supabase = await ensurePrivateBucket();
  const { error: uploadError } = await supabase.storage.from(CUSTOMER_REQUEST_EVIDENCE_BUCKET)
    .upload(path, bytes, { contentType: detected.mimeType, upsert: false });
  if (uploadError) return mobileError("errors.serverError", 500);
  try {
    const [metadata] = await db.transaction(async (tx) => {
      const [locked] = await tx.select({
        status: serviceCustomerRequests.status,
        submittedAt: serviceCustomerRequests.submittedAt,
        tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
      }).from(serviceCustomerRequests)
        .where(and(
          eq(serviceCustomerRequests.id, current.id),
          eq(serviceCustomerRequests.tokenHash, tokenHash),
        )).for("update").limit(1);
      if (!locked || !isCustomerRequestTokenSubmittable({
        status: locked.status,
        submittedAt: locked.submittedAt,
        expiresAt: locked.tokenExpiresAt,
      })) throw new Error("CUSTOMER_REQUEST_NOT_SUBMITTABLE");
      const [lockedCount] = await tx.select({ value: count() })
        .from(serviceCustomerRequestAttachments)
        .where(eq(serviceCustomerRequestAttachments.requestId, current.id));
      if (lockedCount.value >= 3) throw new Error("CUSTOMER_REQUEST_EVIDENCE_LIMIT");
      const rows = await tx.insert(serviceCustomerRequestAttachments).values({
        requestId: current.id,
        bucket: CUSTOMER_REQUEST_EVIDENCE_BUCKET,
        path,
        fileName: safeName,
        mimeType: detected.mimeType,
        sizeBytes: bytes.length,
        sha256,
      }).returning({
        id: serviceCustomerRequestAttachments.id,
        fileName: serviceCustomerRequestAttachments.fileName,
        mimeType: serviceCustomerRequestAttachments.mimeType,
        sizeBytes: serviceCustomerRequestAttachments.sizeBytes,
        sha256: serviceCustomerRequestAttachments.sha256,
      });
      return rows;
    });
    return mobileOk(metadata);
  } catch {
    await supabase.storage.from(CUSTOMER_REQUEST_EVIDENCE_BUCKET).remove([path]);
    return mobileError("errors.notFound", 404);
  }
}
