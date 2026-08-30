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

type MediaTransaction = Pick<typeof db, "select" | "update">;
type MediaTransactionalDatabase = Pick<typeof db, "transaction">;

async function hasLiveMediaReference(
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
  if (malformedAiDocument) return "malformed";

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
          and attachment->>'mediaId' = ${input.mediaId}
      )`,
    )).limit(1);
  return aiReference ? "referenced" : "none";
}

export async function softDeleteMediaIfUnreferencedInTransaction(
  transaction: MediaTransaction,
  input: SoftDeleteMediaInput,
): Promise<SoftDeleteMediaResult> {
  const [media] = await transaction.select().from(mediaObjects).where(and(
    eq(mediaObjects.storeId, input.storeId),
    eq(mediaObjects.id, input.mediaId),
    eq(mediaObjects.status, "ready"),
  )).limit(1).for("update");
  if (!media) return { outcome: "conflict" };
  if (
    (input.expectedPurpose && media.purpose !== input.expectedPurpose)
    || (input.expectedTargetId && media.targetId !== input.expectedTargetId)
  ) {
    return { outcome: "conflict" };
  }

  const referenceState = await hasLiveMediaReference(transaction, input);
  if (referenceState === "malformed") {
    return { outcome: "conflict" };
  }
  if (referenceState === "referenced") {
    return { outcome: "referenced" };
  }

  const [deleted] = await transaction.update(mediaObjects).set({
    status: "deleted",
    deletedAt: input.deletedAt ?? new Date(),
  }).where(and(
    eq(mediaObjects.storeId, input.storeId),
    eq(mediaObjects.id, input.mediaId),
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
