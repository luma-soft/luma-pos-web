import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { getLiveMediaReferenceStateInTransaction } from "@/lib/media/repository-core";
import type { ObjectStorage } from "@/lib/media/types";

const MAX_BATCH_SIZE = 50;
const DEFAULT_BATCH_SIZE = 50;
const PENDING_RETENTION_MS = 24 * 60 * 60 * 1_000;
const CLEANUP_LEASE_MS = 15 * 60 * 1_000;

export type MediaCleanupCandidate = {
  id: string;
  provider: "r2";
  bucket: string;
  objectKey: string;
  thumbnailObjectKey: string | null;
  sizeBytes: number;
  thumbnailSizeBytes: number | null;
  reason: "pending-expired" | "soft-deleted";
};

export type MediaCleanupRepository = {
  claim(input: {
    now: Date;
    batchSize: number;
    leaseToken: string;
    pendingExpiredBefore: Date;
    staleLeaseBefore: Date;
  }): Promise<MediaCleanupCandidate[]>;
  complete(input: {
    id: string;
    leaseToken: string;
    completedAt: Date;
  }): Promise<boolean>;
  fail(input: {
    id: string;
    leaseToken: string;
    failedAt: Date;
    error: string;
  }): Promise<boolean>;
};

export type MediaCleanupResult = {
  claimed: number;
  pendingExpired: number;
  softDeleted: number;
  cleaned: number;
  missingObjects: number;
  failed: number;
  bytesReclaimed: number;
};

type MediaCleanupDatabase = Pick<typeof db, "transaction" | "update">;

type CleanupRow = {
  id: string;
  provider: "r2";
  bucket: string;
  object_key: string;
  thumbnail_object_key: string | null;
  size_bytes: string | number;
  thumbnail_size_bytes: string | number | null;
  reason: MediaCleanupCandidate["reason"];
};

function rowToCandidate(row: CleanupRow): MediaCleanupCandidate {
  return {
    id: row.id,
    provider: row.provider,
    bucket: row.bucket,
    objectKey: row.object_key,
    thumbnailObjectKey: row.thumbnail_object_key,
    sizeBytes: Number(row.size_bytes),
    thumbnailSizeBytes: row.thumbnail_size_bytes === null
      ? null
      : Number(row.thumbnail_size_bytes),
    reason: row.reason,
  };
}

export function createDatabaseMediaCleanupRepository(
  database: MediaCleanupDatabase,
): MediaCleanupRepository {
  return {
    async claim(input) {
      return database.transaction(async (transaction) => {
        const result = await transaction.execute(sql`
          select media.id, media.store_id, media.provider, media.bucket,
            media.object_key, media.thumbnail_object_key, media.size_bytes,
            media.thumbnail_size_bytes,
            case when media.status = 'pending'
              then 'pending-expired'
              else 'soft-deleted'
            end as reason
          from media_objects media
          where media.provider = 'r2'
            and media.storage_deleted_at is null
            and (
              media.cleanup_claim_token is null
              or media.cleanup_claimed_at <= ${input.staleLeaseBefore}
            )
            and (
              (
                media.status = 'pending'
                and media.upload_expires_at <= ${input.pendingExpiredBefore}
              )
              or (
                media.status = 'deleted'
                and media.deleted_at is not null
              )
            )
            and not exists (
              select 1 from brands
              where brands.store_id = media.store_id
                and brands.logo_media_object_id = media.id
            )
            and not exists (
              select 1 from product_media
              where product_media.store_id = media.store_id
                and product_media.media_object_id = media.id
                and product_media.deleted_at is null
            )
            and not exists (
              select 1 from service_attachments
              where service_attachments.store_id = media.store_id
                and service_attachments.media_object_id = media.id
                and service_attachments.deleted_at is null
            )
            and not exists (
              select 1 from service_customer_request_attachments
              where service_customer_request_attachments.store_id = media.store_id
                and service_customer_request_attachments.media_object_id = media.id
            )
            and not exists (
              select 1 from service_handover_document_media
              where service_handover_document_media.store_id = media.store_id
                and service_handover_document_media.media_object_id = media.id
            )
            and not exists (
              select 1 from media_migration_items
              where media_migration_items.store_id = media.store_id
                and media_migration_items.media_object_id = media.id
                and media_migration_items.status <> 'rolled_back'
            )
            and not exists (
              select 1
              from service_signatures signature
              join service_attachments attachment
                on attachment.id = signature.attachment_id
               and attachment.store_id = signature.store_id
              where signature.store_id = media.store_id
                and attachment.media_object_id = media.id
                and signature.invalidated_at is null
            )
            and not exists (
              select 1
              from ai_chat_messages message,
                jsonb_array_elements(
                  case when jsonb_typeof(message.attachments) = 'array'
                    then message.attachments else '[]'::jsonb end
                ) attachment
              where message.store_id = media.store_id
                and jsonb_typeof(attachment) = 'object'
                and jsonb_typeof(attachment->'mediaId') = 'string'
                and lower(attachment->>'mediaId') = lower(media.id::text)
            )
          order by coalesce(media.deleted_at, media.upload_expires_at), media.id
          for update of media skip locked
          limit ${input.batchSize}
        `);
        const claimed: MediaCleanupCandidate[] = [];
        for (const row of result.rows as Array<CleanupRow & { store_id: string }>) {
          const referenceState = await getLiveMediaReferenceStateInTransaction(
            transaction,
            { storeId: row.store_id, mediaId: row.id },
          );
          if (referenceState !== "none") continue;
          const [updated] = await transaction.update(mediaObjects).set({
            status: "deleted",
            deletedAt: sql`coalesce(${mediaObjects.deletedAt}, ${input.now})`,
            cleanupClaimToken: input.leaseToken,
            cleanupClaimedAt: input.now,
            cleanupAttempts: sql`${mediaObjects.cleanupAttempts} + 1`,
            cleanupLastError: null,
          }).where(and(
            eq(mediaObjects.id, row.id),
            isNull(mediaObjects.storageDeletedAt),
          )).returning({ id: mediaObjects.id });
          if (updated) claimed.push(rowToCandidate(row));
        }
        return claimed;
      });
    },
    async complete(input) {
      const [updated] = await database.update(mediaObjects).set({
        storageDeletedAt: input.completedAt,
        cleanupClaimToken: null,
        cleanupClaimedAt: null,
        cleanupLastError: null,
      }).where(and(
        eq(mediaObjects.id, input.id),
        eq(mediaObjects.cleanupClaimToken, input.leaseToken),
        eq(mediaObjects.status, "deleted"),
        isNull(mediaObjects.storageDeletedAt),
      )).returning({ id: mediaObjects.id });
      return Boolean(updated);
    },
    async fail(input) {
      const [updated] = await database.update(mediaObjects).set({
        cleanupClaimToken: null,
        cleanupClaimedAt: null,
        cleanupLastError: input.error.slice(0, 1_000),
      }).where(and(
        eq(mediaObjects.id, input.id),
        eq(mediaObjects.cleanupClaimToken, input.leaseToken),
        isNull(mediaObjects.storageDeletedAt),
      )).returning({ id: mediaObjects.id });
      return Boolean(updated);
    },
  };
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return candidate.name === "NoSuchKey"
    || candidate.code === "NoSuchKey"
    || candidate.code === "NotFound"
    || candidate.status === 404
    || candidate.statusCode === 404
    || candidate.$metadata?.httpStatusCode === 404;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "media_cleanup_failed";
}

async function defaultDependencies() {
  const [{ db: database }, { getObjectStorage }] = await Promise.all([
    import("@/db"),
    import("@/lib/media/storage"),
  ]);
  return {
    repository: createDatabaseMediaCleanupRepository(database),
    storage: getObjectStorage("r2"),
  };
}

export async function drainMediaCleanup(input: {
  now?: Date;
  batchSize?: number;
  repository?: MediaCleanupRepository;
  storage?: Pick<ObjectStorage, "remove">;
  createLeaseToken?: () => string;
} = {}): Promise<MediaCleanupResult> {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("invalid_media_cleanup_batch_size");
  }

  const defaults = input.repository && input.storage
    ? null
    : await defaultDependencies();
  const repository = input.repository ?? defaults!.repository;
  const storage = input.storage ?? defaults!.storage;
  const leaseToken = (input.createLeaseToken ?? randomUUID)();
  const candidates = await repository.claim({
    now,
    batchSize,
    leaseToken,
    pendingExpiredBefore: new Date(now.getTime() - PENDING_RETENTION_MS),
    staleLeaseBefore: new Date(now.getTime() - CLEANUP_LEASE_MS),
  });
  const result: MediaCleanupResult = {
    claimed: candidates.length,
    pendingExpired: candidates.filter((item) => item.reason === "pending-expired").length,
    softDeleted: candidates.filter((item) => item.reason === "soft-deleted").length,
    cleaned: 0,
    missingObjects: 0,
    failed: 0,
    bytesReclaimed: 0,
  };

  for (const candidate of candidates) {
    const objects = new Map<string, number>();
    objects.set(candidate.objectKey, candidate.sizeBytes);
    if (
      candidate.thumbnailObjectKey
      && !objects.has(candidate.thumbnailObjectKey)
    ) {
      objects.set(candidate.thumbnailObjectKey, candidate.thumbnailSizeBytes ?? 0);
    }

    let removedBytes = 0;
    let failure: unknown = null;
    for (const [key, sizeBytes] of objects) {
      try {
        await storage.remove({ bucket: candidate.bucket, key });
        removedBytes += sizeBytes;
      } catch (error) {
        if (isMissingObject(error)) {
          result.missingObjects += 1;
          continue;
        }
        failure = error;
        break;
      }
    }

    if (failure) {
      await repository.fail({
        id: candidate.id,
        leaseToken,
        failedAt: now,
        error: errorMessage(failure),
      });
      result.failed += 1;
      continue;
    }

    const completed = await repository.complete({
      id: candidate.id,
      leaseToken,
      completedAt: now,
    });
    if (!completed) {
      result.failed += 1;
      continue;
    }
    result.cleaned += 1;
    result.bytesReclaimed += removedBytes;
  }

  return result;
}
