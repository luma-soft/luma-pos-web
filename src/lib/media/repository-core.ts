import { and, eq, isNull, ne, sql } from "drizzle-orm";

import type { db } from "@/db";
import {
  aiChatMessages,
  brands,
  mediaMigrationItems,
  mediaObjects,
  productMedia,
  serviceAttachments,
  serviceCustomerRequestAttachments,
  serviceHandoverDocumentMedia,
  serviceSignatures,
} from "@/db/schema";
import type { MediaPurpose } from "@/lib/media/schemas";
import {
  canonicalizeNullableUuidCoordinate,
  canonicalizeUuidCoordinate,
  nullableUuidCoordinatesEqual,
  uuidCoordinatesEqual,
} from "@/lib/media/uuid-coordinate";

export type SoftDeleteMediaInput = {
  storeId: string;
  mediaId: string;
  deletedAt?: Date;
  expectedPurpose?: MediaPurpose;
  expectedTargetId?: string;
};

export type SoftDeleteMediaResult =
  | { outcome: "deleted"; media: { id: string } }
  | { outcome: "referenced" }
  | { outcome: "conflict" };

export type RecoverReadyMediaAfterFailureInput = {
  storeId: string;
  mediaId: string;
  expectedPurpose: MediaPurpose;
  expectedTargetId: string;
  expectedObjectKey: string;
  expectedCreatedBy: string | null;
  recoveredAt?: Date;
};

export type RecoverReadyMediaAfterFailureResult =
  | { outcome: "deleted"; media: { id: string } }
  | { outcome: "quarantined"; media: { id: string } }
  | { outcome: "referenced" }
  | { outcome: "conflict" };

type MediaTransaction = Pick<typeof db, "select" | "update">;
type MediaTransactionalDatabase = Pick<typeof db, "transaction">;

export async function getLiveMediaReferenceStateInTransaction(
  transaction: MediaTransaction,
  input: Pick<SoftDeleteMediaInput, "storeId" | "mediaId">,
): Promise<"referenced" | "malformed" | "none"> {
  const queries = [
    transaction.select({ id: brands.id }).from(brands).where(and(
      eq(brands.storeId, input.storeId),
      eq(brands.logoMediaObjectId, input.mediaId),
    )).limit(1),
    transaction.select({ id: productMedia.id }).from(productMedia).where(and(
      eq(productMedia.storeId, input.storeId),
      eq(productMedia.mediaObjectId, input.mediaId),
      isNull(productMedia.deletedAt),
    )).limit(1),
    transaction.select({ id: serviceAttachments.id }).from(serviceAttachments).where(and(
      eq(serviceAttachments.storeId, input.storeId),
      eq(serviceAttachments.mediaObjectId, input.mediaId),
      isNull(serviceAttachments.deletedAt),
    )).limit(1),
    transaction.select({ id: serviceCustomerRequestAttachments.id })
      .from(serviceCustomerRequestAttachments)
      .where(and(
        eq(serviceCustomerRequestAttachments.storeId, input.storeId),
        eq(serviceCustomerRequestAttachments.mediaObjectId, input.mediaId),
      )).limit(1),
    transaction.select({ id: serviceHandoverDocumentMedia.id })
      .from(serviceHandoverDocumentMedia)
      .where(and(
        eq(serviceHandoverDocumentMedia.storeId, input.storeId),
        eq(serviceHandoverDocumentMedia.mediaObjectId, input.mediaId),
      )).limit(1),
    transaction.select({ id: mediaMigrationItems.id }).from(mediaMigrationItems).where(and(
      eq(mediaMigrationItems.storeId, input.storeId),
      eq(mediaMigrationItems.mediaObjectId, input.mediaId),
      ne(mediaMigrationItems.status, "rolled_back"),
    )).limit(1),
    transaction.select({ id: serviceSignatures.id })
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
  ];

  // Keep these queries sequential on the transaction's single connection.
  for (const query of queries) {
    if ((await query)[0]) return "referenced";
  }

  const [aiReference] = await transaction.select({ id: aiChatMessages.id })
    .from(aiChatMessages)
    .where(and(
      eq(aiChatMessages.storeId, input.storeId),
      sql`exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(${aiChatMessages.attachments}) = 'array'
            then ${aiChatMessages.attachments} else '[]'::jsonb end
        ) attachment
        where jsonb_typeof(attachment) = 'object'
          and jsonb_typeof(attachment->'mediaId') = 'string'
          and lower(attachment->>'mediaId') = lower(${input.mediaId})
      )`,
    )).limit(1);
  if (aiReference) return "referenced";

  const [malformedAiDocument] = await transaction.select({ id: aiChatMessages.id })
    .from(aiChatMessages)
    .where(and(
      eq(aiChatMessages.storeId, input.storeId),
      sql`${aiChatMessages.attachments} is not null and (
        jsonb_typeof(${aiChatMessages.attachments}) <> 'array'
        or exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(${aiChatMessages.attachments}) = 'array'
              then ${aiChatMessages.attachments} else '[]'::jsonb end
          ) attachment
          where jsonb_typeof(attachment) <> 'object'
             or (
               attachment ? 'mediaId'
               and (
                 jsonb_typeof(attachment->'mediaId') <> 'string'
                 or attachment->>'mediaId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
               )
             )
        )
      )`,
    )).limit(1);
  return malformedAiDocument ? "malformed" : "none";
}

function createdByCondition(expectedCreatedBy: string | null) {
  return expectedCreatedBy === null
    ? isNull(mediaObjects.createdBy)
    : eq(mediaObjects.createdBy, expectedCreatedBy);
}

export async function recoverReadyMediaAfterFailureInTransaction(
  transaction: MediaTransaction,
  input: RecoverReadyMediaAfterFailureInput,
): Promise<RecoverReadyMediaAfterFailureResult> {
  const coordinates = {
    ...input,
    storeId: canonicalizeUuidCoordinate(input.storeId),
    mediaId: canonicalizeUuidCoordinate(input.mediaId),
    expectedTargetId: canonicalizeUuidCoordinate(input.expectedTargetId),
    expectedCreatedBy: canonicalizeNullableUuidCoordinate(input.expectedCreatedBy),
  };
  const [media] = await transaction.select().from(mediaObjects).where(and(
    eq(mediaObjects.storeId, coordinates.storeId),
    eq(mediaObjects.id, coordinates.mediaId),
  )).limit(1).for("update");
  if (
    !media
    || media.purpose !== coordinates.expectedPurpose
    || !uuidCoordinatesEqual(media.targetId, coordinates.expectedTargetId)
    || media.objectKey !== coordinates.expectedObjectKey
    || !nullableUuidCoordinatesEqual(media.createdBy, coordinates.expectedCreatedBy)
  ) return { outcome: "conflict" };

  if (media.status === "deleted") {
    return { outcome: "deleted", media };
  }
  if (media.status === "quarantined") {
    return { outcome: "quarantined", media };
  }
  if (media.status !== "ready") return { outcome: "conflict" };

  const referenceState = await getLiveMediaReferenceStateInTransaction(transaction, coordinates);
  if (referenceState === "referenced") return { outcome: "referenced" };

  const status = referenceState === "malformed" ? "quarantined" : "deleted";
  const [recovered] = await transaction.update(mediaObjects).set({
    status,
    deletedAt: status === "deleted" ? coordinates.recoveredAt ?? new Date() : null,
  }).where(and(
    eq(mediaObjects.storeId, coordinates.storeId),
    eq(mediaObjects.id, coordinates.mediaId),
    eq(mediaObjects.status, "ready"),
    eq(mediaObjects.purpose, coordinates.expectedPurpose),
    eq(mediaObjects.targetId, coordinates.expectedTargetId),
    eq(mediaObjects.objectKey, coordinates.expectedObjectKey),
    createdByCondition(coordinates.expectedCreatedBy),
  )).returning();
  if (!recovered) return { outcome: "conflict" };
  return status === "deleted"
    ? { outcome: "deleted", media: recovered }
    : { outcome: "quarantined", media: recovered };
}

export async function softDeleteMediaIfUnreferencedInTransaction(
  transaction: MediaTransaction,
  input: SoftDeleteMediaInput,
): Promise<SoftDeleteMediaResult> {
  const coordinates = {
    ...input,
    storeId: canonicalizeUuidCoordinate(input.storeId),
    mediaId: canonicalizeUuidCoordinate(input.mediaId),
    expectedTargetId: input.expectedTargetId
      ? canonicalizeUuidCoordinate(input.expectedTargetId)
      : undefined,
  };
  const [media] = await transaction.select().from(mediaObjects).where(and(
    eq(mediaObjects.storeId, coordinates.storeId),
    eq(mediaObjects.id, coordinates.mediaId),
    eq(mediaObjects.status, "ready"),
  )).limit(1).for("update");
  if (!media) return { outcome: "conflict" };
  if (
    (coordinates.expectedPurpose && media.purpose !== coordinates.expectedPurpose)
    || (
      coordinates.expectedTargetId
      && !uuidCoordinatesEqual(media.targetId, coordinates.expectedTargetId)
    )
  ) {
    return { outcome: "conflict" };
  }

  const referenceState = await getLiveMediaReferenceStateInTransaction(transaction, coordinates);
  if (referenceState === "malformed") {
    return { outcome: "conflict" };
  }
  if (referenceState === "referenced") {
    return { outcome: "referenced" };
  }

  const [deleted] = await transaction.update(mediaObjects).set({
    status: "deleted",
    deletedAt: coordinates.deletedAt ?? new Date(),
  }).where(and(
    eq(mediaObjects.storeId, coordinates.storeId),
    eq(mediaObjects.id, coordinates.mediaId),
    eq(mediaObjects.status, "ready"),
  )).returning();
  return deleted
    ? { outcome: "deleted", media: deleted }
    : { outcome: "conflict" };
}

export function softDeleteMediaIfUnreferencedCore(
  database: MediaTransactionalDatabase,
  input: SoftDeleteMediaInput,
): Promise<SoftDeleteMediaResult> {
  return database.transaction((transaction) =>
    softDeleteMediaIfUnreferencedInTransaction(transaction, input)
  );
}

export function recoverReadyMediaAfterFailureCore(
  database: MediaTransactionalDatabase,
  input: RecoverReadyMediaAfterFailureInput,
): Promise<RecoverReadyMediaAfterFailureResult> {
  return database.transaction((transaction) =>
    recoverReadyMediaAfterFailureInTransaction(transaction, input)
  );
}
