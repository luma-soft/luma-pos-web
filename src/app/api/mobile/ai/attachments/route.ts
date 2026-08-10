import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { requireAiProviderConfigured } from "@/lib/ai/config";
import { getAiAttachmentsBucket } from "@/lib/data/settings";
import { requireMobileAiManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ACCEPTED: Map<string, { ext: string; kind: "image" | "document" }> = new Map([
  ["image/png", { ext: "png", kind: "image" }],
  ["image/jpeg", { ext: "jpg", kind: "image" }],
  ["image/webp", { ext: "webp", kind: "image" }],
  ["application/pdf", { ext: "pdf", kind: "document" }],
  ["text/csv", { ext: "csv", kind: "document" }],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { ext: "xlsx", kind: "document" }],
] as const);

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "attachment";
}

function hasZipSignature(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function sniffMime(bytes: Uint8Array, declared: string) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (declared === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && hasZipSignature(bytes)) return declared;
  if (declared === "text/csv") return declared;
  return null;
}

async function ensureBucket(bucketName: string) {
  const supabase = createSupabaseAdminClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  if (!buckets.some((bucket) => bucket.name === bucketName)) {
    const { error } = await supabase.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: MAX_ATTACHMENT_BYTES,
      allowedMimeTypes: [...ACCEPTED.keys()],
    });
    if (error) throw error;
  }
  return supabase;
}

export async function POST(request: Request) {
  const gate = await requireMobileAiManager();
  if (!gate.ok) return mobileGate(gate)!;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const aiBlocked = await requireAiProviderConfigured();
  if (aiBlocked) return aiBlocked;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return mobileError("errors.invalidData", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return mobileError("errors.invalidData", 400);
  }
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: "upload_ai_attachment",
      entityType: "ai_attachment",
      status: "failed",
      metadata: { reason: "invalid_size", fileName: file.name, size: file.size },
    });
    return mobileError("ai.attachments.invalidSize", 400);
  }
  const accepted = ACCEPTED.get(file.type);
  if (!accepted) {
    return mobileError("ai.attachments.unsupportedType", 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(buffer.subarray(0, 16), file.type);
  if (sniffed !== file.type) {
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: "upload_ai_attachment",
      entityType: "ai_attachment",
      status: "failed",
      metadata: { reason: "mime_mismatch", fileName: file.name, declaredType: file.type, sniffed },
    });
    return mobileError("ai.attachments.unsupportedType", 400);
  }

  const name = safeFileName(file.name);
  const path = `stores/${gate.storeId}/users/${gate.userId}/${Date.now()}-${randomUUID()}-${name}`;
  const bucketName = await getAiAttachmentsBucket(gate.storeId);

  try {
    const supabase = await ensureBucket(bucketName);
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: signed, error: signedError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(path, 60 * 60);
    if (signedError) throw signedError;

    const attachment = {
      id: path,
      bucket: bucketName,
      path,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      kind: accepted.kind,
      signedUrl: signed.signedUrl,
    };

    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: "upload_ai_attachment",
      entityType: "ai_attachment",
      entityId: path,
      status: "succeeded",
      after: {
        id: path,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        kind: accepted.kind,
      },
      affectedRecords: [{ type: "ai_attachment", id: path, code: file.name }],
      metadata: { bucket: bucketName, surface: form.get("surface") || "web" },
    });

    return mobileOk(attachment);
  } catch (error) {
    console.error("upload_ai_attachment failed:", error);
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: "upload_ai_attachment",
      entityType: "ai_attachment",
      status: "failed",
      metadata: { fileName: file.name, mimeType: file.type, size: file.size },
    });
    return mobileError("errors.serverError", 500);
  }
}

export async function GET(request: Request) {
  const gate = await requireMobileAiManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);

  const url = new URL(request.url);
  const bucket = url.searchParams.get("bucket")?.trim();
  const path = url.searchParams.get("path")?.trim();
  const configuredBucket = await getAiAttachmentsBucket(gate.storeId);

  if (!bucket || !path || bucket !== configuredBucket || !path.startsWith(`${gate.userId}/`)) {
    return mobileError("errors.forbidden", 403);
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60);
    if (error) throw error;
    return mobileOk({ signedUrl: data.signedUrl });
  } catch (error) {
    console.error("sign_ai_attachment failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
