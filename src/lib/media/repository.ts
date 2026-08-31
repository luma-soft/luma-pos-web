import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import {
  recoverReadyMediaAfterFailureCore,
  softDeleteMediaIfUnreferencedCore,
  type RecoverReadyMediaAfterFailureInput,
  type RecoverReadyMediaAfterFailureResult,
  type SoftDeleteMediaInput,
  type SoftDeleteMediaResult,
} from "@/lib/media/repository-core";
import type { MediaProvider, MediaVisibility } from "@/lib/media/types";
import type { MediaPurpose } from "@/lib/media/schemas";
import {
  canonicalizeNullableUuidCoordinate,
  canonicalizeUuidCoordinate,
} from "@/lib/media/uuid-coordinate";

export type CreatePendingMediaInput = {
  id: string;
  storeId: string;
  provider: MediaProvider;
  visibility: MediaVisibility;
  purpose: MediaPurpose;
  targetId: string;
  domain: string;
  bucket: string;
  objectKey: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadExpiresAt: Date;
  createdBy?: string | null;
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  legacyBucket?: string | null;
  legacyPath?: string | null;
  legacyUrl?: string | null;
};

export type MarkMediaReadyInput = {
  storeId: string;
  mediaId: string;
  actualSizeBytes: number;
  readyAt?: Date;
  verifiedAt?: Date;
};

export type SaveMediaThumbnailInput = {
  storeId: string;
  mediaId: string;
  objectKey: string;
  sizeBytes: number;
};

export type AbandonPendingMediaInput = {
  storeId: string;
  mediaId: string;
  expectedPurpose: MediaPurpose;
  expectedTargetId: string;
  deletedAt: Date;
};

export type {
  RecoverReadyMediaAfterFailureInput,
  RecoverReadyMediaAfterFailureResult,
  SoftDeleteMediaInput,
  SoftDeleteMediaResult,
} from "@/lib/media/repository-core";

export function buildCreatePendingMediaQuery(
  database: Pick<typeof db, "insert">,
  input: CreatePendingMediaInput,
) {
  return database.insert(mediaObjects).values({
    id: canonicalizeUuidCoordinate(input.id),
    storeId: canonicalizeUuidCoordinate(input.storeId),
    provider: input.provider,
    visibility: input.visibility,
    purpose: input.purpose,
    targetId: canonicalizeUuidCoordinate(input.targetId),
    domain: input.domain,
    bucket: input.bucket,
    objectKey: input.objectKey,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    uploadExpiresAt: input.uploadExpiresAt,
    status: "pending",
    createdBy: canonicalizeNullableUuidCoordinate(input.createdBy ?? null),
    sha256: input.sha256 ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    legacyBucket: input.legacyBucket ?? null,
    legacyPath: input.legacyPath ?? null,
    legacyUrl: input.legacyUrl ?? null,
  }).returning();
}

export async function createPendingMedia(input: CreatePendingMediaInput) {
  const [row] = await buildCreatePendingMediaQuery(db, input);
  return row;
}

export function buildMarkMediaReadyQuery(
  database: Pick<typeof db, "update">,
  input: MarkMediaReadyInput,
) {
  return database.update(mediaObjects).set({
    status: "ready",
    sizeBytes: input.actualSizeBytes,
    readyAt: input.readyAt ?? new Date(),
    verifiedAt: input.verifiedAt ?? new Date(),
  }).where(and(
    eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
    eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
    eq(mediaObjects.status, "pending"),
  )).returning();
}

export async function markMediaReady(input: MarkMediaReadyInput) {
  const [row] = await buildMarkMediaReadyQuery(db, input);
  return row ?? null;
}

export function buildSaveMediaThumbnailQuery(
  database: Pick<typeof db, "update">,
  input: SaveMediaThumbnailInput,
) {
  return database.update(mediaObjects).set({
    thumbnailObjectKey: input.objectKey,
    thumbnailSizeBytes: input.sizeBytes,
  }).where(and(
    eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
    eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
    eq(mediaObjects.status, "ready"),
  )).returning();
}

export async function saveMediaThumbnail(input: SaveMediaThumbnailInput) {
  const [row] = await buildSaveMediaThumbnailQuery(db, input);
  return row ?? null;
}

export function buildAbandonPendingMediaQuery(
  database: Pick<typeof db, "update">,
  input: AbandonPendingMediaInput,
) {
  return database.update(mediaObjects).set({
    status: "deleted",
    deletedAt: input.deletedAt,
  }).where(and(
    eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
    eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
    eq(mediaObjects.status, "pending"),
    eq(mediaObjects.purpose, input.expectedPurpose),
    eq(mediaObjects.targetId, canonicalizeUuidCoordinate(input.expectedTargetId)),
  )).returning();
}

export async function abandonPendingMedia(input: AbandonPendingMediaInput) {
  const [row] = await buildAbandonPendingMediaQuery(db, input);
  return row ?? null;
}

export type GetMediaForStoreInput = {
  storeId: string;
  mediaId: string;
};

export function buildGetMediaForStoreQuery(
  database: Pick<typeof db, "select">,
  input: GetMediaForStoreInput,
) {
  return database.select()
    .from(mediaObjects)
    .where(and(
      eq(mediaObjects.id, canonicalizeUuidCoordinate(input.mediaId)),
      eq(mediaObjects.storeId, canonicalizeUuidCoordinate(input.storeId)),
    ))
    .limit(1);
}

export async function getMediaForStore(input: GetMediaForStoreInput) {
  const [row] = await buildGetMediaForStoreQuery(db, input);
  return row ?? null;
}

export function softDeleteMediaIfUnreferenced(
  input: SoftDeleteMediaInput,
): Promise<SoftDeleteMediaResult> {
  return softDeleteMediaIfUnreferencedCore(db, input);
}

export function recoverReadyMediaAfterFailure(
  input: RecoverReadyMediaAfterFailureInput,
): Promise<RecoverReadyMediaAfterFailureResult> {
  return recoverReadyMediaAfterFailureCore(db, input);
}
