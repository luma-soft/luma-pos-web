import { createHash } from "node:crypto";
import { z } from "zod";

import type { MediaActor } from "@/lib/media/authorization";
import {
  getProjectMediaManager,
  parseProjectMediaMultipart,
  ProjectMediaError,
  ProjectMediaRepositoryError,
  projectMediaUploadSchema,
  sniffProjectMediaMime,
  type ProjectMediaManager,
} from "@/lib/media/project-media";
import { MediaServiceError } from "@/lib/media/service";
import {
  requireMobileServiceAccess,
  type MobileGate,
} from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";

type RouteContext = { params: Promise<{ id: string }> };

function actorFromGate(gate: Extract<MobileGate, { ok: true }>): MediaActor {
  return {
    storeId: gate.storeId,
    userId: gate.userId,
    role: gate.role,
    features: gate.features,
  };
}

function projectMediaFailure(error: unknown) {
  if (error instanceof ProjectMediaError || error instanceof MediaServiceError) {
    return mobileError(error.error, error.status);
  }
  if (error instanceof ProjectMediaRepositoryError) {
    if (
      error.code === "PROJECT_MEDIA_PROJECT_NOT_FOUND"
      || error.code === "PROJECT_MEDIA_DOCUMENT_NOT_FOUND"
    ) return mobileError("errors.notFound", 404);
    return mobileError("media.associationConflict", 409);
  }
  console.error("project media request failed:", error);
  return mobileError("errors.serverError", 500);
}

export function createProjectAttachmentHandlers(dependencies: {
  authenticate?: () => Promise<MobileGate>;
  manager?: ProjectMediaManager;
} = {}) {
  const authenticate = dependencies.authenticate ?? requireMobileServiceAccess;
  const manager = () => dependencies.manager ?? getProjectMediaManager();

  return {
    async GET(request: Request, { params }: RouteContext) {
      const gate = await authenticate();
      const blocked = mobileGate(gate);
      if (blocked) return blocked;
      if (!gate.ok) return mobileError("errors.unauthorized", 401);
      const { id } = await params;
      if (!z.uuid().safeParse(id).success) return mobileError("errors.notFound", 404);
      try {
        const searchParams = new URL(request.url).searchParams;
        if (searchParams.get("download") === "1") {
          const attachmentId = searchParams.get("attachmentId")?.trim();
          if (!attachmentId || !z.uuid().safeParse(attachmentId).success) {
            return mobileError("errors.invalidData", 400);
          }
          const download = await manager().download(
            actorFromGate(gate),
            id,
            attachmentId,
          );
          return new Response(null, {
            status: 307,
            headers: {
              Location: download.url,
              "Cache-Control": "no-store",
            },
          });
        }
        return mobileOk(await manager().list(actorFromGate(gate), id));
      } catch (error) {
        return projectMediaFailure(error);
      }
    },

    async POST(request: Request, { params }: RouteContext) {
      const gate = await authenticate();
      const blocked = mobileGate(gate);
      if (blocked) return blocked;
      if (!gate.ok) return mobileError("errors.unauthorized", 401);
      const { id } = await params;
      if (!z.uuid().safeParse(id).success) return mobileError("errors.notFound", 404);

      let multipart: Awaited<ReturnType<typeof parseProjectMediaMultipart>>;
      try {
        multipart = await parseProjectMediaMultipart(request);
      } catch (error) {
        return mobileError(
          "errors.invalidData",
          error instanceof Error
            && error.message === "PROJECT_MEDIA_MULTIPART_TOO_LARGE"
            ? 413
            : 400,
        );
      }
      const { file, fields } = multipart;
      const bytes = file.bytes;
      const detectedMime = sniffProjectMediaMime(
        bytes,
        file.fileName,
        file.mimeType,
      );
      if (!detectedMime) {
        return mobileError("services.errors.unsupportedEvidence", 400);
      }
      const parsed = projectMediaUploadSchema.safeParse({
        phase: fields.phase,
        caption: fields.caption ?? null,
        documentId: fields.documentId,
        idempotencyKey: fields.idempotencyKey,
        fileName: file.fileName,
        mimeType: detectedMime,
        sizeBytes: bytes.byteLength,
      });
      if (!parsed.success) return mobileError("errors.invalidData", 400);
      try {
        return mobileOk(await manager().upload(actorFromGate(gate), id, {
          ...parsed.data,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }, bytes));
      } catch (error) {
        return projectMediaFailure(error);
      }
    },

    async DELETE(request: Request, { params }: RouteContext) {
      const gate = await authenticate();
      const blocked = mobileGate(gate);
      if (blocked) return blocked;
      if (!gate.ok) return mobileError("errors.unauthorized", 401);
      const { id } = await params;
      const attachmentId = new URL(request.url).searchParams.get("attachmentId")?.trim();
      if (
        !z.uuid().safeParse(id).success
        || !attachmentId
        || !z.uuid().safeParse(attachmentId).success
      ) return mobileError("errors.invalidData", 400);
      try {
        return mobileOk(await manager().delete(
          actorFromGate(gate),
          id,
          attachmentId,
        ));
      } catch (error) {
        return projectMediaFailure(error);
      }
    },
  };
}

const handlers = createProjectAttachmentHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
