import { randomUUID as nodeRandomUUID } from "node:crypto";

import type { MediaVisibility, ObjectStorage } from "@/lib/media/types";
import { getR2Config } from "@/lib/media/config";
import { createMediaThumbnail, isSafeRasterMimeType } from "@/lib/media/image-variants";
import { createObjectKey } from "@/lib/media/object-key";
import {
  createPendingMedia,
  getMediaForStore,
  markMediaReady,
  saveMediaThumbnail,
  softDeleteMediaIfUnreferenced,
  type CreatePendingMediaInput,
  type GetMediaForStoreInput,
  type MarkMediaReadyInput,
  type SaveMediaThumbnailInput,
  type SoftDeleteMediaInput,
  type SoftDeleteMediaResult,
} from "@/lib/media/repository";
import {
  extensionForMediaType,
  mediaIdSchema,
  MEDIA_PURPOSES,
  normalizeMediaType,
  uploadIntentSchema,
  type MediaPurpose,
} from "@/lib/media/schemas";
import { getObjectStorage } from "@/lib/media/storage";
import {
  authorizeMediaTarget,
  type AuthorizeMediaTarget,
  type MediaActor,
} from "@/lib/media/authorization";

const UPLOAD_EXPIRY_SECONDS = 600;
const DOWNLOAD_EXPIRY_SECONDS = 900;

export type MediaStatus = "pending" | "ready" | "quarantined" | "deleted";

export type MediaRecord = {
  id: string;
  storeId: string;
  provider: "r2" | "supabase";
  visibility: MediaVisibility;
  purpose: MediaPurpose;
  targetId: string;
  domain: string;
  bucket: string;
  objectKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  status: MediaStatus;
  createdBy: string | null;
  createdAt: Date;
  uploadExpiresAt: Date;
  readyAt: Date | null;
  verifiedAt: Date | null;
  deletedAt: Date | null;
  thumbnailObjectKey: string | null;
  thumbnailSizeBytes: number | null;
};

export type MediaDescriptor = {
  id: string;
  visibility: MediaVisibility;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  url: string;
  thumbnailUrl: string | null;
};

export type MediaRepository = {
  createPending(input: CreatePendingMediaInput): Promise<MediaRecord>;
  getForStore(input: GetMediaForStoreInput): Promise<MediaRecord | null>;
  markReady(input: Required<MarkMediaReadyInput>): Promise<MediaRecord | null>;
  saveThumbnail(input: SaveMediaThumbnailInput): Promise<MediaRecord | null>;
  softDeleteIfUnreferenced(
    input: Required<SoftDeleteMediaInput>,
  ): Promise<SoftDeleteMediaResult>;
};

export class MediaServiceError extends Error {
  constructor(
    readonly error: string,
    readonly status: number,
  ) {
    super(error);
    this.name = "MediaServiceError";
  }
}

export function mediaServiceError(error: unknown): { error: string; status: number } {
  if (error instanceof MediaServiceError) {
    return { error: error.error, status: error.status };
  }
  return { error: "errors.serverError", status: 500 };
}

export type MediaService = ReturnType<typeof createMediaService>;

export type MediaServiceDependencies = {
  storage: ObjectStorage;
  repository: MediaRepository;
  config: { publicBucket: string; privateBucket: string };
  authorizeTarget: AuthorizeMediaTarget;
  now?: () => Date;
  randomUUID?: () => string;
  logger?: Pick<Console, "error">;
};

function defaultRepository(): MediaRepository {
  return {
    createPending: createPendingMedia as MediaRepository["createPending"],
    getForStore: getMediaForStore as MediaRepository["getForStore"],
    markReady: markMediaReady as MediaRepository["markReady"],
    saveThumbnail: saveMediaThumbnail as MediaRepository["saveThumbnail"],
    softDeleteIfUnreferenced: softDeleteMediaIfUnreferenced,
  };
}

function thumbnailKey(objectKey: string): string {
  const marker = objectKey.lastIndexOf("/");
  if (marker < 0) throw new Error("Media object key has no prefix");
  return `${objectKey.slice(0, marker)}/thumbnail.webp`;
}

export function createMediaService(dependencies: MediaServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.randomUUID ?? nodeRandomUUID;
  const logger = dependencies.logger ?? console;

  async function requireTarget(
    actor: MediaActor,
    purpose: MediaPurpose,
    targetId: string,
    conceal: boolean,
  ) {
    const result = await dependencies.authorizeTarget({ actor, purpose, targetId });
    if (result === "allowed") return;
    if (conceal || result === "not_found") {
      throw new MediaServiceError("errors.notFound", 404);
    }
    throw new MediaServiceError("errors.forbidden", 403);
  }

  async function descriptor(record: MediaRecord): Promise<MediaDescriptor> {
    const url = record.visibility === "public"
      ? dependencies.storage.publicUrl({ key: record.objectKey })
      : await dependencies.storage.createDownloadUrl({
        bucket: record.bucket,
        key: record.objectKey,
        expiresInSeconds: DOWNLOAD_EXPIRY_SECONDS,
      });
    const thumbnailUrl = !record.thumbnailObjectKey
      ? null
      : record.visibility === "public"
        ? dependencies.storage.publicUrl({ key: record.thumbnailObjectKey })
        : await dependencies.storage.createDownloadUrl({
          bucket: record.bucket,
          key: record.thumbnailObjectKey,
          expiresInSeconds: DOWNLOAD_EXPIRY_SECONDS,
        });
    return {
      id: record.id,
      visibility: record.visibility,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      fileName: record.originalFileName,
      url,
      thumbnailUrl,
    };
  }

  async function createUploadIntent(actor: MediaActor, value: unknown) {
    const parsed = uploadIntentSchema.safeParse(value);
    if (!parsed.success) throw new MediaServiceError("errors.invalidData", 400);
    const input = parsed.data;
    await requireTarget(actor, input.purpose, input.targetId, false);

    const policy = MEDIA_PURPOSES[input.purpose];
    const mediaId = createId();
    if (!mediaIdSchema.safeParse(mediaId).success) {
      throw new Error("Generated media ID is invalid");
    }
    const extension = extensionForMediaType(input.mimeType);
    if (!extension) throw new MediaServiceError("errors.invalidData", 400);
    const createdAt = now();
    const uploadExpiresAt = new Date(
      createdAt.getTime() + UPLOAD_EXPIRY_SECONDS * 1000,
    );
    const bucket = policy.visibility === "public"
      ? dependencies.config.publicBucket
      : dependencies.config.privateBucket;
    const objectKey = createObjectKey({
      storeId: actor.storeId,
      domain: policy.domain,
      mediaId,
      fileName: `original.${extension}`,
      now: createdAt,
    });
    const media = await dependencies.repository.createPending({
      id: mediaId,
      storeId: actor.storeId,
      provider: "r2",
      visibility: policy.visibility,
      purpose: input.purpose,
      targetId: input.targetId,
      domain: policy.domain,
      bucket,
      objectKey,
      originalFileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadExpiresAt,
      createdBy: actor.userId,
    });
    const uploadUrl = await dependencies.storage.createUploadUrl({
      bucket,
      key: objectKey,
      contentType: input.mimeType,
      ifNoneMatch: "*",
      expiresInSeconds: UPLOAD_EXPIRY_SECONDS,
    });
    return {
      media: {
        id: media.id,
        visibility: media.visibility,
        status: media.status,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        fileName: media.originalFileName,
      },
      method: "PUT" as const,
      uploadUrl,
      headers: {
        "Content-Type": input.mimeType,
        "If-None-Match": "*",
      },
      expiresAt: uploadExpiresAt.toISOString(),
    };
  }

  async function loadAuthorizedReady(actor: MediaActor, mediaId: string) {
    if (!mediaIdSchema.safeParse(mediaId).success) {
      throw new MediaServiceError("errors.notFound", 404);
    }
    const media = await dependencies.repository.getForStore({
      storeId: actor.storeId,
      mediaId,
    });
    if (!media || media.status !== "ready") {
      throw new MediaServiceError("errors.notFound", 404);
    }
    await requireTarget(actor, media.purpose, media.targetId, true);
    return media;
  }

  async function resolveMedia(actor: MediaActor, mediaId: string) {
    return descriptor(await loadAuthorizedReady(actor, mediaId));
  }

  async function completeUpload(actor: MediaActor, mediaId: string) {
    if (!mediaIdSchema.safeParse(mediaId).success) {
      throw new MediaServiceError("errors.notFound", 404);
    }
    let media = await dependencies.repository.getForStore({
      storeId: actor.storeId,
      mediaId,
    });
    if (!media || media.status === "quarantined" || media.status === "deleted") {
      throw new MediaServiceError("errors.notFound", 404);
    }
    await requireTarget(actor, media.purpose, media.targetId, true);
    if (media.status === "ready") return descriptor(media);
    if (media.status !== "pending") {
      throw new MediaServiceError("errors.notFound", 404);
    }
    const completedAt = now();
    if (completedAt.getTime() >= media.uploadExpiresAt.getTime()) {
      throw new MediaServiceError("media.uploadExpired", 410);
    }
    const head = await dependencies.storage.head({
      bucket: media.bucket,
      key: media.objectKey,
    });
    if (!head) throw new MediaServiceError("media.uploadIncomplete", 409);
    if (
      head.sizeBytes !== media.sizeBytes
      || normalizeMediaType(head.contentType ?? "") !== normalizeMediaType(media.mimeType)
    ) {
      throw new MediaServiceError("media.uploadMismatch", 409);
    }

    const ready = await dependencies.repository.markReady({
      storeId: actor.storeId,
      mediaId,
      actualSizeBytes: head.sizeBytes,
      readyAt: completedAt,
      verifiedAt: completedAt,
    });
    if (!ready) {
      const raced = await dependencies.repository.getForStore({
        storeId: actor.storeId,
        mediaId,
      });
      if (raced?.status === "ready") return descriptor(raced);
      throw new MediaServiceError("media.uploadConflict", 409);
    }
    media = ready;

    if (isSafeRasterMimeType(media.mimeType)) {
      try {
        const original = await dependencies.storage.get({
          bucket: media.bucket,
          key: media.objectKey,
        });
        const thumbnail = await createMediaThumbnail(original, media.mimeType);
        const objectKey = thumbnailKey(media.objectKey);
        await dependencies.storage.put({
          bucket: media.bucket,
          key: objectKey,
          body: thumbnail,
          contentType: "image/webp",
        });
        const updated = await dependencies.repository.saveThumbnail({
          storeId: actor.storeId,
          mediaId,
          objectKey,
          sizeBytes: thumbnail.byteLength,
        });
        if (!updated) throw new Error("Thumbnail metadata update was rejected");
        media = updated;
      } catch (error) {
        logger.error("media thumbnail generation failed", {
          mediaId,
          error,
        });
      }
    }
    return descriptor(media);
  }

  async function deleteMedia(actor: MediaActor, mediaId: string) {
    const authorized = await loadAuthorizedReady(actor, mediaId);
    const coordinates = { storeId: actor.storeId, mediaId };
    const result = await dependencies.repository.softDeleteIfUnreferenced({
      ...coordinates,
      deletedAt: now(),
      expectedPurpose: authorized.purpose,
      expectedTargetId: authorized.targetId,
    });
    if (result.outcome === "referenced") {
      throw new MediaServiceError("media.referenced", 409);
    }
    if (result.outcome === "conflict") {
      throw new MediaServiceError("media.deleteConflict", 409);
    }
    return { id: result.media.id, status: "deleted" as const };
  }

  return { createUploadIntent, completeUpload, resolveMedia, deleteMedia };
}

let singleton: MediaService | null = null;

export function getMediaService(): MediaService {
  if (!singleton) {
    const config = getR2Config();
    singleton = createMediaService({
      storage: getObjectStorage("r2"),
      repository: defaultRepository(),
      config,
      authorizeTarget: authorizeMediaTarget,
    });
  }
  return singleton;
}
