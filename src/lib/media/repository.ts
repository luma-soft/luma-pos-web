import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiChatMessages,
  aiChatSessions,
  mediaObjects,
  productMedia,
  serviceAttachments,
  serviceCustomerRequestAttachments,
  serviceHandoverDocumentMedia,
  serviceSignatures,
} from "@/db/schema";
import type { MediaProvider, MediaVisibility } from "@/lib/media/types";
import type { MediaPurpose } from "@/lib/media/schemas";

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

export type SoftDeleteMediaInput = {
  storeId: string;
  mediaId: string;
  deletedAt?: Date;
};

export function buildCreatePendingMediaQuery(
  database: Pick<typeof db, "insert">,
  input: CreatePendingMediaInput,
) {
  return database.insert(mediaObjects).values({
    id: input.id,
    storeId: input.storeId,
    provider: input.provider,
    visibility: input.visibility,
    purpose: input.purpose,
    targetId: input.targetId,
    domain: input.domain,
    bucket: input.bucket,
    objectKey: input.objectKey,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    uploadExpiresAt: input.uploadExpiresAt,
    status: "pending",
    createdBy: input.createdBy ?? null,
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
    eq(mediaObjects.id, input.mediaId),
    eq(mediaObjects.storeId, input.storeId),
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
    eq(mediaObjects.id, input.mediaId),
    eq(mediaObjects.storeId, input.storeId),
    eq(mediaObjects.status, "ready"),
  )).returning();
}

export async function saveMediaThumbnail(input: SaveMediaThumbnailInput) {
  const [row] = await buildSaveMediaThumbnailQuery(db, input);
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
      eq(mediaObjects.id, input.mediaId),
      eq(mediaObjects.storeId, input.storeId),
    ))
    .limit(1);
}

export async function getMediaForStore(input: GetMediaForStoreInput) {
  const [row] = await buildGetMediaForStoreQuery(db, input);
  return row ?? null;
}

export function buildSoftDeleteMediaQuery(
  database: Pick<typeof db, "update">,
  input: SoftDeleteMediaInput,
) {
  return database.update(mediaObjects).set({
    status: "deleted",
    deletedAt: input.deletedAt ?? new Date(),
  }).where(and(
    eq(mediaObjects.id, input.mediaId),
    eq(mediaObjects.storeId, input.storeId),
    eq(mediaObjects.status, "ready"),
  )).returning();
}

export async function softDeleteMedia(input: SoftDeleteMediaInput) {
  const [row] = await buildSoftDeleteMediaQuery(db, input);
  return row ?? null;
}

export async function isMediaDeletionProtected(input: GetMediaForStoreInput) {
  const [product, attachment, customerRequest, handover, signature, aiMessage] = await Promise.all([
    db.select({ id: productMedia.id }).from(productMedia).where(and(
      eq(productMedia.storeId, input.storeId),
      eq(productMedia.mediaObjectId, input.mediaId),
      isNull(productMedia.deletedAt),
    )).limit(1),
    db.select({ id: serviceAttachments.id }).from(serviceAttachments).where(and(
      eq(serviceAttachments.storeId, input.storeId),
      eq(serviceAttachments.mediaObjectId, input.mediaId),
      isNull(serviceAttachments.deletedAt),
    )).limit(1),
    db.select({ id: serviceCustomerRequestAttachments.id })
      .from(serviceCustomerRequestAttachments)
      .where(and(
        eq(serviceCustomerRequestAttachments.storeId, input.storeId),
        eq(serviceCustomerRequestAttachments.mediaObjectId, input.mediaId),
      )).limit(1),
    db.select({ id: serviceHandoverDocumentMedia.id })
      .from(serviceHandoverDocumentMedia)
      .where(and(
        eq(serviceHandoverDocumentMedia.storeId, input.storeId),
        eq(serviceHandoverDocumentMedia.mediaObjectId, input.mediaId),
      )).limit(1),
    db.select({ id: serviceSignatures.id })
      .from(serviceSignatures)
      .innerJoin(serviceAttachments, and(
        eq(serviceAttachments.id, serviceSignatures.attachmentId),
        eq(serviceAttachments.storeId, serviceSignatures.storeId),
      ))
      .where(and(
        eq(serviceSignatures.storeId, input.storeId),
        eq(serviceAttachments.mediaObjectId, input.mediaId),
        isNull(serviceSignatures.invalidatedAt),
      )).limit(1),
    db.select({ id: aiChatMessages.id })
      .from(aiChatMessages)
      .innerJoin(aiChatSessions, and(
        eq(aiChatSessions.id, aiChatMessages.sessionId),
        eq(aiChatSessions.storeId, aiChatMessages.storeId),
      ))
      .where(and(
        eq(aiChatMessages.storeId, input.storeId),
        isNull(aiChatSessions.deletedAt),
        sql`exists (
          select 1
          from jsonb_array_elements(coalesce(${aiChatMessages.attachments}, '[]'::jsonb)) attachment
          where attachment->>'mediaId' = ${input.mediaId}
        )`,
      )).limit(1),
  ]);
  return Boolean(
    product[0]
    || attachment[0]
    || customerRequest[0]
    || handover[0]
    || signature[0]
    || aiMessage[0],
  );
}
