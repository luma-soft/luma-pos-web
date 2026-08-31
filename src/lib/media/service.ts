import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";

import {
  isDefinitiveObjectStorageWriteError,
  type MediaVisibility,
  type ObjectStorage,
} from "@/lib/media/types";
import { getR2Config } from "@/lib/media/config";
import { createMediaThumbnail, isSafeRasterMimeType } from "@/lib/media/image-variants";
import { createObjectKey } from "@/lib/media/object-key";
import { db } from "@/db";
import {
  createDatabaseMediaRepository,
  type CreatePendingMediaInput,
  type AbandonPendingMediaInput,
  type GetMediaForStoreInput,
  type MarkMediaReadyInput,
  type QuarantinePendingMediaInput,
  type RecoverReadyMediaAfterFailureInput,
  type RecoverReadyMediaAfterFailureResult,
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
  type UploadIntentInput,
} from "@/lib/media/schemas";
import { getObjectStorage } from "@/lib/media/storage";
import {
  authorizeMediaTarget,
  canonicalizeMediaActor,
  type AuthorizeMediaTarget,
  type MediaActor,
} from "@/lib/media/authorization";
import {
  canonicalizeUuidCoordinate,
  nullableUuidCoordinatesEqual,
  uuidCoordinatesEqual,
} from "@/lib/media/uuid-coordinate";

const UPLOAD_EXPIRY_SECONDS = 600;
const DOWNLOAD_EXPIRY_SECONDS = 900;
const RESERVED_UPLOAD_IO_TIMEOUT_MS = 20_000;
const CANONICAL_PRODUCT_IMAGE_PATH = new RegExp(
  "^stores/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
    + "/products/[0-9]{4}/(?:0[1-9]|1[0-2])/"
    + "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
    + "/original\\.(jpg|png|webp)$",
);
const PRODUCT_IMAGE_MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

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
  sha256: string | null;
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

export type ReservedMediaUploadLock = {
  media: MediaRecord;
  markReady(input: Required<MarkMediaReadyInput>): Promise<MediaRecord | null>;
  abandonPending(input: AbandonPendingMediaInput): Promise<MediaRecord | null>;
  quarantinePending(input: QuarantinePendingMediaInput): Promise<MediaRecord | null>;
};

export type MediaRepository = {
  createPending(input: CreatePendingMediaInput): Promise<MediaRecord>;
  reservePending(input: CreatePendingMediaInput): Promise<{
    media: MediaRecord;
    created: boolean;
  } | null>;
  getForStore(input: GetMediaForStoreInput): Promise<MediaRecord | null>;
  withReservedUploadLock<T>(
    input: GetMediaForStoreInput,
    operation: (lock: ReservedMediaUploadLock) => Promise<T>,
  ): Promise<T | null>;
  markReady(input: Required<MarkMediaReadyInput>): Promise<MediaRecord | null>;
  saveThumbnail(input: SaveMediaThumbnailInput): Promise<MediaRecord | null>;
  abandonPending(input: AbandonPendingMediaInput): Promise<MediaRecord | null>;
  quarantinePending(input: QuarantinePendingMediaInput): Promise<MediaRecord | null>;
  recoverReadyAfterFailure(
    input: Required<RecoverReadyMediaAfterFailureInput>,
  ): Promise<RecoverReadyMediaAfterFailureResult>;
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
  reservedUploadIoTimeoutMs?: number;
};

function defaultRepository(): MediaRepository {
  return createDatabaseMediaRepository(db) as MediaRepository;
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
  const reservedUploadIoTimeoutMs = dependencies.reservedUploadIoTimeoutMs
    ?? RESERVED_UPLOAD_IO_TIMEOUT_MS;
  if (!Number.isFinite(reservedUploadIoTimeoutMs) || reservedUploadIoTimeoutMs <= 0) {
    throw new Error("Reserved upload I/O timeout must be positive");
  }

  async function withReservedUploadIoDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, reservedUploadIoTimeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (timedOut) {
        throw new MediaServiceError("media.uploadInProgress", 503);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function requireTarget(
    candidateActor: MediaActor,
    purpose: MediaPurpose,
    candidateTargetId: string,
    conceal: boolean,
  ) {
    const actor = canonicalizeMediaActor(candidateActor);
    const targetId = canonicalizeUuidCoordinate(candidateTargetId);
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

  async function createPendingObject(
    candidateActor: MediaActor,
    input: UploadIntentInput,
  ) {
    const actor = canonicalizeMediaActor(candidateActor);
    const targetId = canonicalizeUuidCoordinate(input.targetId);
    await requireTarget(actor, input.purpose, targetId, false);

    const policy = MEDIA_PURPOSES[input.purpose];
    const parsedMediaId = mediaIdSchema.safeParse(createId());
    if (!parsedMediaId.success) {
      throw new Error("Generated media ID is invalid");
    }
    const mediaId = parsedMediaId.data;
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
      targetId,
      domain: policy.domain,
      bucket,
      objectKey,
      originalFileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadExpiresAt,
      createdBy: actor.userId,
    });
    return { media, uploadExpiresAt };
  }

  async function reserveManagedObject(candidateActor: MediaActor, value: unknown) {
    const parsed = uploadIntentSchema.safeParse(value);
    const reservation = value && typeof value === "object"
      ? value as { reservationId?: unknown; sha256?: unknown }
      : {};
    const parsedReservationId = mediaIdSchema.safeParse(reservation.reservationId);
    const sha256 = typeof reservation.sha256 === "string"
      && /^[0-9a-f]{64}$/i.test(reservation.sha256)
      ? reservation.sha256.toLowerCase()
      : null;
    if (!parsed.success || !parsedReservationId.success || !sha256) {
      throw new MediaServiceError("errors.invalidData", 400);
    }

    const actor = canonicalizeMediaActor(candidateActor);
    const input = parsed.data;
    const targetId = canonicalizeUuidCoordinate(input.targetId);
    await requireTarget(actor, input.purpose, targetId, false);
    const policy = MEDIA_PURPOSES[input.purpose];
    const extension = extensionForMediaType(input.mimeType);
    if (!extension) throw new MediaServiceError("errors.invalidData", 400);
    const mediaId = parsedReservationId.data;
    const createdAt = now();
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
    const reserved = await dependencies.repository.reservePending({
      id: mediaId,
      storeId: actor.storeId,
      provider: "r2",
      visibility: policy.visibility,
      purpose: input.purpose,
      targetId,
      domain: policy.domain,
      bucket,
      objectKey,
      originalFileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256,
      uploadExpiresAt: new Date(createdAt.getTime() + UPLOAD_EXPIRY_SECONDS * 1000),
      createdBy: actor.userId,
    });
    const media = reserved?.media;
    const expectedKeyPrefix = `stores/${actor.storeId}/${policy.domain}/`;
    const expectedKeySuffix = `/${mediaId}/original.${extension}`;
    if (
      !media
      || media.storeId !== actor.storeId
      || media.provider !== "r2"
      || media.visibility !== policy.visibility
      || media.purpose !== input.purpose
      || !uuidCoordinatesEqual(media.targetId, targetId)
      || media.domain !== policy.domain
      || media.bucket !== bucket
      || !media.objectKey.startsWith(expectedKeyPrefix)
      || !media.objectKey.endsWith(expectedKeySuffix)
      || media.originalFileName !== input.fileName
      || normalizeMediaType(media.mimeType) !== input.mimeType
      || media.sizeBytes !== input.sizeBytes
      || media.sha256 !== sha256
      || !nullableUuidCoordinatesEqual(media.createdBy, actor.userId)
      || media.deletedAt !== null
      || (media.status !== "pending" && media.status !== "ready")
    ) {
      throw new MediaServiceError("media.reservationConflict", 409);
    }
    return {
      mediaId: media.id,
      path: media.objectKey,
      status: media.status,
      created: reserved.created,
    };
  }

  async function createUploadIntent(actor: MediaActor, value: unknown) {
    const parsed = uploadIntentSchema.safeParse(value);
    if (!parsed.success) throw new MediaServiceError("errors.invalidData", 400);
    const input = parsed.data;
    const { media, uploadExpiresAt } = await createPendingObject(actor, input);
    const bucket = media.bucket;
    const objectKey = media.objectKey;
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

  async function loadAuthorizedReady(candidateActor: MediaActor, candidateMediaId: string) {
    const parsedMediaId = mediaIdSchema.safeParse(candidateMediaId);
    if (!parsedMediaId.success) {
      throw new MediaServiceError("errors.notFound", 404);
    }
    const actor = canonicalizeMediaActor(candidateActor);
    const mediaId = parsedMediaId.data;
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

  async function readMedia(actor: MediaActor, mediaId: string) {
    const media = await loadAuthorizedReady(actor, mediaId);
    const bytes = await dependencies.storage.get({
      bucket: media.bucket,
      key: media.objectKey,
    });
    return { media, bytes };
  }

  async function saveThumbnailForReadyMedia(media: MediaRecord): Promise<MediaRecord> {
    if (!isSafeRasterMimeType(media.mimeType)) return media;
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
        storeId: media.storeId,
        mediaId: media.id,
        objectKey,
        sizeBytes: thumbnail.byteLength,
      });
      if (!updated) throw new Error("Thumbnail metadata update was rejected");
      return updated;
    } catch (error) {
      logger.error("media thumbnail generation failed", {
        mediaId: media.id,
        error,
      });
      return media;
    }
  }

  async function completeUploadInternal(
    candidateActor: MediaActor,
    candidateMediaId: string,
    allowVerifiedExpiredObject = false,
  ) {
    const parsedMediaId = mediaIdSchema.safeParse(candidateMediaId);
    if (!parsedMediaId.success) {
      throw new MediaServiceError("errors.notFound", 404);
    }
    const actor = canonicalizeMediaActor(candidateActor);
    const mediaId = parsedMediaId.data;
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
    if (!allowVerifiedExpiredObject && completedAt.getTime() >= media.uploadExpiresAt.getTime()) {
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

    media = await saveThumbnailForReadyMedia(media);
    return descriptor(media);
  }

  async function completeUpload(candidateActor: MediaActor, candidateMediaId: string) {
    return completeUploadInternal(candidateActor, candidateMediaId);
  }

  async function putManagedObject(
    candidateActor: MediaActor,
    value: unknown,
    bytes: Uint8Array,
  ) {
    const parsed = uploadIntentSchema.safeParse(value);
    if (
      !parsed.success
      || !(bytes instanceof Uint8Array)
      || bytes.byteLength !== parsed.data.sizeBytes
    ) {
      throw new MediaServiceError("errors.invalidData", 400);
    }
    const actor = canonicalizeMediaActor(candidateActor);
    const input = parsed.data;
    const { media } = await createPendingObject(actor, input);
    let wroteObject = false;
    try {
      await dependencies.storage.put({
        bucket: media.bucket,
        key: media.objectKey,
        body: bytes,
        contentType: media.mimeType,
        ifNoneMatch: "*",
      });
      wroteObject = true;
      const completed = await completeUpload(actor, media.id);
      return {
        mediaId: completed.id,
        path: media.objectKey,
        url: completed.url,
      };
    } catch (error) {
      if (!wroteObject && !isDefinitiveObjectStorageWriteError(error)) {
        throw error;
      }
      let current: MediaRecord | null;
      try {
        current = await dependencies.repository.getForStore({
          storeId: actor.storeId,
          mediaId: media.id,
        });
      } catch (recoveryError) {
        logger.error("media write compensation failed", {
          mediaId: media.id,
          error: recoveryError,
        });
        throw recoveryError;
      }
      if (wroteObject && current?.status === "ready") {
        let recovered: RecoverReadyMediaAfterFailureResult;
        try {
          recovered = await dependencies.repository.recoverReadyAfterFailure({
            storeId: actor.storeId,
            mediaId: media.id,
            expectedPurpose: media.purpose,
            expectedTargetId: media.targetId,
            expectedObjectKey: media.objectKey,
            expectedCreatedBy: media.createdBy,
            recoveredAt: now(),
          });
        } catch (recoveryError) {
          logger.error("media ready compensation failed", {
            mediaId: media.id,
            error: recoveryError,
          });
          throw recoveryError;
        }
        if (recovered.outcome === "conflict") {
          logger.error("media ready compensation conflicted", {
            mediaId: media.id,
          });
          throw new MediaServiceError("media.readyRecoveryConflict", 500);
        }
        if (recovered.outcome !== "deleted") {
          logger.error("media ready compensation was retained", {
            mediaId: media.id,
            outcome: recovered.outcome,
          });
        }
      } else {
        try {
          const abandoned = await dependencies.repository.abandonPending({
            storeId: actor.storeId,
            mediaId: media.id,
            expectedPurpose: media.purpose,
            expectedTargetId: media.targetId,
            deletedAt: now(),
          });
          if (wroteObject && abandoned) {
            try {
              await dependencies.storage.remove({
                bucket: media.bucket,
                key: media.objectKey,
              });
            } catch (cleanupError) {
              logger.error("media object compensation failed", {
                mediaId: media.id,
                error: cleanupError,
              });
            }
          }
        } catch (cleanupError) {
          logger.error("media write compensation failed", {
            mediaId: media.id,
            error: cleanupError,
          });
        }
      }
      throw error;
    }
  }

  async function putReservedManagedObject(
    candidateActor: MediaActor,
    candidateMediaId: string,
    bytes: Uint8Array,
  ) {
    const parsedMediaId = mediaIdSchema.safeParse(candidateMediaId);
    if (!parsedMediaId.success || !(bytes instanceof Uint8Array)) {
      throw new MediaServiceError("errors.invalidData", 400);
    }
    const actor = canonicalizeMediaActor(candidateActor);
    const mediaId = parsedMediaId.data;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const media = await dependencies.repository.getForStore({
      storeId: actor.storeId,
      mediaId,
    });
    if (
      !media
      || (media.status !== "pending" && media.status !== "ready")
      || bytes.byteLength !== media.sizeBytes
      || !media.sha256
      || sha256 !== media.sha256
    ) {
      throw new MediaServiceError("media.reservationConflict", 409);
    }
    const reservedMedia = media;
    await requireTarget(actor, reservedMedia.purpose, reservedMedia.targetId, true);

    if (reservedMedia.status === "ready") {
      const completed = await descriptor(reservedMedia);
      return {
        mediaId: completed.id,
        path: reservedMedia.objectKey,
        url: completed.url,
      };
    }

    type ReservedObjectInspection =
      | { outcome: "missing" }
      | { outcome: "mismatch" }
      | { outcome: "verified"; actualSizeBytes: number };
    type ReservedUploadOutcome =
      | { outcome: "ready"; media: MediaRecord }
      | { outcome: "expired" }
      | { outcome: "mismatch" }
      | { outcome: "conflict" };

    function matchesReservation(record: MediaRecord) {
      return (
        (record.status === "pending" || record.status === "ready")
        && record.storeId === reservedMedia.storeId
        && record.provider === reservedMedia.provider
        && record.visibility === reservedMedia.visibility
        && record.purpose === reservedMedia.purpose
        && uuidCoordinatesEqual(record.targetId, reservedMedia.targetId)
        && record.domain === reservedMedia.domain
        && record.bucket === reservedMedia.bucket
        && record.objectKey === reservedMedia.objectKey
        && record.originalFileName === reservedMedia.originalFileName
        && normalizeMediaType(record.mimeType) === normalizeMediaType(reservedMedia.mimeType)
        && record.sizeBytes === reservedMedia.sizeBytes
        && record.sha256 === sha256
        && nullableUuidCoordinatesEqual(record.createdBy, reservedMedia.createdBy)
        && record.deletedAt === null
      );
    }

    async function inspectExistingObject(
      record: MediaRecord,
    ): Promise<ReservedObjectInspection> {
      const head = await withReservedUploadIoDeadline((signal) => dependencies.storage.head({
        bucket: record.bucket,
        key: record.objectKey,
        signal,
      }));
      if (!head) return { outcome: "missing" };
      if (
        head.sizeBytes !== record.sizeBytes
        || normalizeMediaType(head.contentType ?? "") !== normalizeMediaType(record.mimeType)
      ) {
        return { outcome: "mismatch" };
      }
      const storedBytes = await withReservedUploadIoDeadline((signal) => dependencies.storage.get({
        bucket: record.bucket,
        key: record.objectKey,
        signal,
      }));
      if (createHash("sha256").update(storedBytes).digest("hex") !== record.sha256) {
        return { outcome: "mismatch" };
      }
      return { outcome: "verified", actualSizeBytes: head.sizeBytes };
    }

    const resolved = await dependencies.repository.withReservedUploadLock(
      { storeId: actor.storeId, mediaId: reservedMedia.id },
      async (lock): Promise<ReservedUploadOutcome> => {
        const lockedMedia = lock.media;
        if (!matchesReservation(lockedMedia)) return { outcome: "conflict" };
        if (lockedMedia.status === "ready") {
          return { outcome: "ready", media: lockedMedia };
        }

        const markVerifiedReady = async (actualSizeBytes: number) => {
          const completedAt = now();
          const ready = await lock.markReady({
            storeId: actor.storeId,
            mediaId: lockedMedia.id,
            actualSizeBytes,
            readyAt: completedAt,
            verifiedAt: completedAt,
          });
          return ready
            ? { outcome: "ready", media: ready } as const
            : { outcome: "conflict" } as const;
        };

        const existing = await inspectExistingObject(lockedMedia);
        if (existing.outcome === "verified") {
          return markVerifiedReady(existing.actualSizeBytes);
        }

        const checkedAt = now();
        if (checkedAt.getTime() >= lockedMedia.uploadExpiresAt.getTime()) {
          if (existing.outcome === "mismatch") {
            const quarantined = await lock.quarantinePending({
              storeId: actor.storeId,
              mediaId: lockedMedia.id,
              expectedPurpose: lockedMedia.purpose,
              expectedTargetId: lockedMedia.targetId,
            });
            return quarantined ? { outcome: "mismatch" } : { outcome: "conflict" };
          }
          const abandoned = await lock.abandonPending({
            storeId: actor.storeId,
            mediaId: lockedMedia.id,
            expectedPurpose: lockedMedia.purpose,
            expectedTargetId: lockedMedia.targetId,
            deletedAt: checkedAt,
          });
          return abandoned ? { outcome: "expired" } : { outcome: "conflict" };
        }
        if (existing.outcome === "mismatch") return { outcome: "mismatch" };

        try {
          await withReservedUploadIoDeadline((signal) => dependencies.storage.put({
            bucket: lockedMedia.bucket,
            key: lockedMedia.objectKey,
            body: bytes,
            contentType: lockedMedia.mimeType,
            ifNoneMatch: "*",
            signal,
          }));
        } catch (error) {
          if (!isDefinitiveObjectStorageWriteError(error)) throw error;
          const raced = await inspectExistingObject(lockedMedia);
          if (raced.outcome === "verified") {
            return markVerifiedReady(raced.actualSizeBytes);
          }
          if (raced.outcome === "mismatch") return { outcome: "mismatch" };
          throw error;
        }

        const written = await inspectExistingObject(lockedMedia);
        if (written.outcome === "verified") {
          return markVerifiedReady(written.actualSizeBytes);
        }
        if (written.outcome === "mismatch") return { outcome: "mismatch" };
        throw new MediaServiceError("media.uploadInProgress", 503);
      },
    );
    if (!resolved || resolved.outcome === "conflict") {
      throw new MediaServiceError("media.reservationConflict", 409);
    }
    if (resolved.outcome === "mismatch") {
      throw new MediaServiceError("media.reservationConflict", 409);
    }
    if (resolved.outcome === "expired") {
      throw new MediaServiceError("media.uploadExpired", 410);
    }

    const completedMedia = await saveThumbnailForReadyMedia(resolved.media);
    const completed = await descriptor(completedMedia);
    return {
      mediaId: completed.id,
      path: completedMedia.objectKey,
      url: completed.url,
    };
  }

  async function deleteMedia(candidateActor: MediaActor, candidateMediaId: string) {
    const parsedMediaId = mediaIdSchema.safeParse(candidateMediaId);
    if (!parsedMediaId.success) {
      throw new MediaServiceError("errors.notFound", 404);
    }
    const actor = canonicalizeMediaActor(candidateActor);
    const mediaId = parsedMediaId.data;
    const authorized = await dependencies.repository.getForStore({
      storeId: actor.storeId,
      mediaId,
    });
    if (
      !authorized
      || (authorized.status !== "pending" && authorized.status !== "ready")
    ) {
      throw new MediaServiceError("errors.notFound", 404);
    }
    await requireTarget(actor, authorized.purpose, authorized.targetId, true);
    if (authorized.status === "pending") {
      const expectedPurpose = authorized.purpose;
      const expectedTargetId = authorized.targetId;
      const pendingDeletion = await dependencies.repository.withReservedUploadLock(
        { storeId: actor.storeId, mediaId },
        async (lock): Promise<
          | { outcome: "deleted"; media: MediaRecord }
          | { outcome: "ready"; media: MediaRecord }
          | { outcome: "conflict" }
        > => {
          const lockedMedia = lock.media;
          if (
            lockedMedia.storeId !== actor.storeId
            || lockedMedia.purpose !== expectedPurpose
            || !uuidCoordinatesEqual(lockedMedia.targetId, expectedTargetId)
          ) return { outcome: "conflict" };
          if (lockedMedia.status === "ready") {
            return { outcome: "ready", media: lockedMedia };
          }
          if (lockedMedia.status !== "pending") return { outcome: "conflict" };
          const deleted = await lock.abandonPending({
            storeId: actor.storeId,
            mediaId,
            expectedPurpose: lockedMedia.purpose,
            expectedTargetId: lockedMedia.targetId,
            deletedAt: now(),
          });
          return deleted
            ? { outcome: "deleted", media: deleted }
            : { outcome: "conflict" };
        },
      );
      if (!pendingDeletion || pendingDeletion.outcome === "conflict") {
        throw new MediaServiceError("media.deleteConflict", 409);
      }
      if (pendingDeletion.outcome === "deleted") {
        try {
          await dependencies.storage.remove({
            bucket: pendingDeletion.media.bucket,
            key: pendingDeletion.media.objectKey,
          });
        } catch (error) {
          logger.error("pending media object cleanup failed", {
            mediaId,
            error,
          });
        }
        return { id: pendingDeletion.media.id, status: "deleted" as const };
      }
      throw new MediaServiceError("media.deleteConflict", 409);
    }
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

  async function deleteManagedProductImageByPath(
    candidateActor: MediaActor,
    objectKey: string,
  ) {
    const actor = canonicalizeMediaActor(candidateActor);
    const match = CANONICAL_PRODUCT_IMAGE_PATH.exec(objectKey);
    const storeId = match?.[1];
    const mediaId = match?.[2];
    const extension = match?.[3] as
      | keyof typeof PRODUCT_IMAGE_MIME_BY_EXTENSION
      | undefined;
    if (
      !storeId
      || !uuidCoordinatesEqual(storeId, actor.storeId)
      || !mediaId
      || !extension
    ) {
      throw new MediaServiceError("errors.notFound", 404);
    }

    const media = await dependencies.repository.getForStore({
      storeId: actor.storeId,
      mediaId,
    });
    if (
      !media
      || !uuidCoordinatesEqual(media.id, mediaId)
      || !uuidCoordinatesEqual(media.storeId, actor.storeId)
      || media.provider !== "r2"
      || media.visibility !== "public"
      || media.purpose !== "product-image"
      || !uuidCoordinatesEqual(media.targetId, actor.storeId)
      || media.domain !== "products"
      || media.bucket !== dependencies.config.publicBucket
      || media.objectKey !== objectKey
      || media.mimeType !== PRODUCT_IMAGE_MIME_BY_EXTENSION[extension]
      || media.status !== "ready"
      || media.deletedAt !== null
    ) {
      throw new MediaServiceError("errors.notFound", 404);
    }

    return deleteMedia(actor, media.id);
  }

  return {
    createUploadIntent,
    completeUpload,
    putManagedObject,
    putReservedManagedObject,
    reserveManagedObject,
    resolveMedia,
    readMedia,
    deleteMedia,
    deleteManagedProductImageByPath,
  };
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
