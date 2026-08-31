import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireAiProviderConfigured } from "@/lib/ai/config";
import { getAiAttachmentsBucket } from "@/lib/data/settings";
import type { MediaActor } from "@/lib/media/authorization";
import { getR2Config } from "@/lib/media/config";
import {
  getMediaService,
  MediaServiceError,
  type MediaService,
} from "@/lib/media/service";
import {
  requireMobileAiUser,
  type MobileGate,
} from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ACCEPTED: Map<string, { kind: "image" | "document" }> = new Map([
  ["image/png", { kind: "image" }],
  ["image/jpeg", { kind: "image" }],
  ["image/webp", { kind: "image" }],
  ["application/pdf", { kind: "document" }],
  ["text/csv", { kind: "document" }],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { kind: "document" }],
] as const);

type AiAttachmentMediaService = Pick<
  MediaService,
  "putManagedObject" | "resolveMedia"
>;

function actorFromGate(gate: Extract<MobileGate, { ok: true }>): MediaActor {
  return {
    storeId: gate.storeId,
    userId: gate.userId,
    role: gate.role,
    features: gate.features,
  };
}

function hasZipSignature(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function sniffMime(bytes: Uint8Array, declared: string) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (
    declared === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    && hasZipSignature(bytes)
  ) return declared;
  if (declared === "text/csv") return declared;
  return null;
}

async function defaultLegacySigner(bucket: string, path: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

function attachmentFailure(error: unknown, operation: string) {
  if (error instanceof MediaServiceError) {
    return mobileError(error.error, error.status);
  }
  console.error(`${operation} failed:`, error);
  return mobileError("errors.serverError", 500);
}

export function createAiAttachmentHandlers(dependencies: {
  authenticate?: () => Promise<MobileGate>;
  requireProvider?: typeof requireAiProviderConfigured;
  mediaService?: AiAttachmentMediaService;
  privateBucket?: string;
  getLegacyBucket?: typeof getAiAttachmentsBucket;
  signLegacy?: (bucket: string, path: string) => Promise<string>;
} = {}) {
  const authenticate = dependencies.authenticate ?? requireMobileAiUser;
  const requireProvider = dependencies.requireProvider ?? requireAiProviderConfigured;
  const mediaService = () => dependencies.mediaService ?? getMediaService();
  const privateBucket = () => dependencies.privateBucket ?? getR2Config().privateBucket;
  const getLegacyBucket = dependencies.getLegacyBucket ?? getAiAttachmentsBucket;
  const signLegacy = dependencies.signLegacy ?? defaultLegacySigner;

  return {
    async POST(request: Request) {
      const gate = await authenticate();
      const blocked = mobileGate(gate);
      if (blocked) return blocked;
      if (!gate.ok) return mobileError("errors.unauthorized", 401);
      const aiBlocked = await requireProvider(gate.storeId);
      if (aiBlocked) return aiBlocked;

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return mobileError("errors.invalidData", 400);
      }

      const file = form.get("file");
      const sessionId = form.get("sessionId")?.toString().trim();
      if (
        !(file instanceof File)
        || !sessionId
        || !z.uuid().safeParse(sessionId).success
      ) {
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
      if (!accepted) return mobileError("ai.attachments.unsupportedType", 400);

      const bytes = new Uint8Array(await file.arrayBuffer());
      const sniffed = sniffMime(bytes.subarray(0, 16), file.type);
      if (sniffed !== file.type) {
        await writeAuditLog({
          actorUserId: gate.userId,
          source: "ai",
          action: "upload_ai_attachment",
          entityType: "ai_attachment",
          status: "failed",
          metadata: {
            reason: "mime_mismatch",
            fileName: file.name,
            declaredType: file.type,
            sniffed,
          },
        });
        return mobileError("ai.attachments.unsupportedType", 400);
      }

      try {
        const service = mediaService();
        const managed = await service.putManagedObject(actorFromGate(gate), {
          purpose: "ai-attachment",
          targetId: sessionId,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }, bytes);
        const attachment = {
          id: managed.mediaId,
          mediaId: managed.mediaId,
          sessionId,
          bucket: privateBucket(),
          path: managed.path,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          kind: accepted.kind,
          signedUrl: managed.url,
        };

        await writeAuditLog({
          actorUserId: gate.userId,
          source: "ai",
          action: "upload_ai_attachment",
          entityType: "ai_attachment",
          entityId: managed.mediaId,
          status: "succeeded",
          after: {
            id: managed.mediaId,
            mediaId: managed.mediaId,
            name: file.name,
            mimeType: file.type,
            size: file.size,
            kind: accepted.kind,
          },
          affectedRecords: [{
            type: "ai_attachment",
            id: managed.mediaId,
            code: file.name,
          }],
          metadata: {
            provider: "r2",
            bucket: privateBucket(),
            sessionId,
            surface: form.get("surface") || "web",
          },
        });

        return mobileOk(attachment);
      } catch (error) {
        await writeAuditLog({
          actorUserId: gate.userId,
          source: "ai",
          action: "upload_ai_attachment",
          entityType: "ai_attachment",
          status: "failed",
          metadata: {
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
            sessionId,
          },
        });
        return attachmentFailure(error, "upload_ai_attachment");
      }
    },

    async GET(request: Request) {
      const gate = await authenticate();
      const blocked = mobileGate(gate);
      if (blocked) return blocked;
      if (!gate.ok) return mobileError("errors.unauthorized", 401);

      const url = new URL(request.url);
      const mediaId = url.searchParams.get("mediaId")?.trim();
      if (mediaId) {
        try {
          const descriptor = await mediaService().resolveMedia(
            actorFromGate(gate),
            mediaId,
          );
          return mobileOk({ mediaId: descriptor.id, signedUrl: descriptor.url });
        } catch (error) {
          return attachmentFailure(error, "resolve_ai_attachment");
        }
      }

      const bucket = url.searchParams.get("bucket")?.trim();
      const path = url.searchParams.get("path")?.trim();
      const configuredBucket = await getLegacyBucket(gate.storeId);
      const ownerPrefix = `stores/${gate.storeId}/users/${gate.userId}/`;
      if (
        !bucket
        || !path
        || bucket !== configuredBucket
        || !path.startsWith(ownerPrefix)
      ) {
        return mobileError("errors.forbidden", 403);
      }
      try {
        return mobileOk({ signedUrl: await signLegacy(bucket, path) });
      } catch (error) {
        return attachmentFailure(error, "sign_legacy_ai_attachment");
      }
    },
  };
}

const handlers = createAiAttachmentHandlers();

export const POST = handlers.POST;
export const GET = handlers.GET;
