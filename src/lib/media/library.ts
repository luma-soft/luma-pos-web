import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { mediaLibraryItems, mediaObjects } from "@/db/schema";
import type { MediaActor } from "@/lib/media/authorization";
import { getPublicMediaConfig } from "@/lib/media/config";
import { mediaLibraryItemIdSchema } from "@/lib/media/library-source-types";
import {
  mediaLibraryItemInputSchema,
  mediaLibraryItemPatchSchema,
  mediaLibraryKindForMime,
  type MediaLibraryItemInput,
} from "@/lib/media/library-schema";
import type {
  MediaLibraryItem,
  MediaLibrarySnapshot,
} from "@/lib/media/library-types";
import { softDeleteMediaIfUnreferencedInTransaction } from "@/lib/media/repository-core";
import { getObjectStorage } from "@/lib/media/storage";
import { getMediaService, MediaServiceError } from "@/lib/media/service";
import { canonicalUuidCoordinateSchema } from "@/lib/media/uuid-coordinate";
import {
  buildMediaLibraryOverviewQuery,
  buildMediaLibraryPageQuery,
  buildMediaLibraryResolveQuery,
  encodeMediaLibraryCursor,
  MediaLibraryQueryError,
  parseMediaLibraryQuery,
  type MediaLibraryOverviewRow,
  type MediaLibraryQuery,
  type MediaLibraryStorageRow,
} from "@/lib/media/library-query";

const LIBRARY_SIGNED_URL_SECONDS = 15 * 60;

export class MediaLibraryError extends Error {
  constructor(
    readonly error: string,
    readonly status: number,
  ) {
    super(error);
    this.name = "MediaLibraryError";
  }
}

export function mediaLibraryError(error: unknown): { error: string; status: number } {
  if (error instanceof MediaLibraryQueryError) return { error: "errors.invalidData", status: 400 };
  return error instanceof MediaLibraryError || error instanceof MediaServiceError
    ? { error: error.error, status: error.status }
    : { error: "errors.serverError", status: 500 };
}

function requireManagerActor(actor: MediaActor) {
  if (actor.role !== "owner" && actor.role !== "manager") {
    throw new MediaLibraryError("errors.forbidden", 403);
  }
}

export async function getMediaLibrarySnapshot(
  actor: MediaActor,
  query: MediaLibraryQuery = parseMediaLibraryQuery(new URLSearchParams()),
): Promise<MediaLibrarySnapshot> {
  const sourceContext = query.includeSources ? { actor, publicMedia: getPublicMediaConfig() } : undefined;
  const [pageResult, overviewResult] = await Promise.all([
    db.execute<MediaLibraryStorageRow>(buildMediaLibraryPageQuery(actor.storeId, query, sourceContext)),
    db.execute<MediaLibraryOverviewRow>(buildMediaLibraryOverviewQuery(actor.storeId, query, sourceContext)),
  ]);
  const rows = pageResult.rows.slice(0, query.limit);
  const overview = overviewResult.rows[0];
  if (!overview) throw new MediaLibraryError("errors.serverError", 500);
  const hasMore = pageResult.rows.length > query.limit;
  const items = await Promise.all(rows.map((row) => signLibraryRow(row, actor)));

  return {
    items,
    albums: overview.albums.sort((left, right) => Number(Boolean(right.system)) - Number(Boolean(left.system))
      || left.name.localeCompare(right.name, "vi")),
    usage: {
      libraryBytes: Number(overview.libraryBytes),
      libraryObjects: overview.libraryObjects,
      totalBytes: Number(overview.totalBytes),
      totalObjects: overview.totalObjects,
    },
    canManage: actor.role === "owner" || actor.role === "manager",
    page: {
      nextCursor: hasMore ? encodeMediaLibraryCursor(rows[rows.length - 1]) : null,
      hasMore,
      totalItems: overview.totalItems,
    },
  };
}

export async function resolveMediaLibraryItem(actor: MediaActor, candidateId: string): Promise<MediaLibraryItem> {
  const parsed = mediaLibraryItemIdSchema.safeParse(candidateId);
  if (!parsed.success) throw new MediaLibraryError("errors.notFound", 404);
  const sourceContext = parsed.data.includes(":") ? { actor, publicMedia: getPublicMediaConfig() } : undefined;
  const result = await db.execute<MediaLibraryStorageRow>(buildMediaLibraryResolveQuery(actor.storeId, parsed.data, sourceContext));
  const row = result.rows[0];
  if (!row) throw new MediaLibraryError("errors.notFound", 404);
  return signLibraryRow(row, actor);
}

async function signLibraryRow(row: MediaLibraryStorageRow, actor: MediaActor): Promise<MediaLibraryItem> {
  const unknownProductImage = row.source?.type === "product" && Boolean(row.directUrl)
    && !row.mediaId && row.mimeType === "image/*";
  const kind = unknownProductImage ? "image" : mediaLibraryKindForMime(row.mimeType);
  if (!kind) throw new MediaLibraryError("errors.invalidData", 500);
  let url: string;
  let thumbnailUrl: string | null;
  if (row.directUrl) {
    // Legacy product images are rendered directly; never fetch arbitrary URLs
    // on the server or pass them to the private-object signer.
    let parsedUrl: URL;
    try { parsedUrl = new URL(row.directUrl); } catch { throw new MediaLibraryError("errors.notFound", 404); }
    if (!row.source || row.source.type !== "product"
      || !["https:", "http:"].includes(parsedUrl.protocol)
      || parsedUrl.username || parsedUrl.password) {
      throw new MediaLibraryError("errors.notFound", 404);
    }
    url = parsedUrl.href;
    thumbnailUrl = null;
  } else {
    const storage = getObjectStorage(row.provider);
    [url, thumbnailUrl] = await Promise.all([
      storage.createDownloadUrl({ bucket: row.bucket, key: row.objectKey, expiresInSeconds: LIBRARY_SIGNED_URL_SECONDS }),
      row.thumbnailObjectKey
        ? storage.createDownloadUrl({ bucket: row.bucket, key: row.thumbnailObjectKey, expiresInSeconds: LIBRARY_SIGNED_URL_SECONDS })
        : Promise.resolve(null),
    ]);
  }
  const manager = actor.role === "owner" || actor.role === "manager";
  return {
    id: row.id, mediaId: row.mediaId, album: row.album, title: row.title,
    note: row.note, tags: row.tags, kind, fileName: row.fileName, mimeType: row.mimeType,
    sizeBytes: row.sizeBytes, createdAt: row.createdAt, creatorName: row.creatorName,
    url, thumbnailUrl,
    metadata: row.metadata ?? null,
    ...(row.source ? { source: row.source } : {}),
    canDelete: !row.source && manager,
    canExtractMetadata: row.source ? row.canExtractMetadata === true && Boolean(row.mediaId) : manager,
    sizeKnown: row.sizeKnown !== false,
    uploadedAt: row.source ? row.uploadedAt ?? null : row.createdAt,
  };
}

export async function extractMediaLibraryMetadata(actor: MediaActor, candidateId: string): Promise<MediaLibraryItem> {
  // Resolve through the exact same tenant, purpose and non-deleted-item boundary.
  const item = await resolveMediaLibraryItem(actor, candidateId);
  if (!item.source) requireManagerActor(actor);
  if (!item.canExtractMetadata || !item.mediaId) throw new MediaLibraryError("errors.forbidden", 403);
  await getMediaService().extractMetadata(actor, item.mediaId);
  return resolveMediaLibraryItem(actor, candidateId);
}

export async function createMediaLibraryItem(
  actor: MediaActor,
  value: unknown,
) {
  requireManagerActor(actor);
  const parsed = mediaLibraryItemInputSchema.safeParse(value);
  if (!parsed.success) throw new MediaLibraryError("errors.invalidData", 400);
  const input: MediaLibraryItemInput = parsed.data;

  return db.transaction(async (transaction) => {
    const [media] = await transaction.select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(and(
        eq(mediaObjects.storeId, actor.storeId),
        eq(mediaObjects.id, input.mediaId),
        eq(mediaObjects.status, "ready"),
        eq(mediaObjects.purpose, "library-asset"),
        eq(mediaObjects.targetId, actor.storeId),
        eq(mediaObjects.createdBy, actor.userId),
      ))
      .limit(1)
      .for("update");
    if (!media) throw new MediaLibraryError("errors.notFound", 404);

    const now = new Date();
    const [item] = await transaction.insert(mediaLibraryItems).values({
      storeId: actor.storeId,
      mediaObjectId: media.id,
      album: input.album,
      title: input.title,
      note: input.note,
      tags: input.tags,
      createdBy: actor.userId,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [mediaLibraryItems.storeId, mediaLibraryItems.mediaObjectId],
      set: {
        album: input.album,
        title: input.title,
        note: input.note,
        tags: input.tags,
        deletedAt: null,
        updatedAt: now,
      },
    }).returning({ id: mediaLibraryItems.id });
    if (!item) throw new MediaLibraryError("errors.serverError", 500);
    return item;
  });
}

export async function updateMediaLibraryItem(actor: MediaActor, value: unknown) {
  requireManagerActor(actor);
  const parsed = mediaLibraryItemPatchSchema.safeParse(value);
  if (!parsed.success) throw new MediaLibraryError("errors.invalidData", 400);
  const input = parsed.data;
  const update: Partial<typeof mediaLibraryItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.album !== undefined) update.album = input.album;
  if (input.title !== undefined) update.title = input.title;
  if (input.note !== undefined) update.note = input.note;
  if (input.tags !== undefined) update.tags = input.tags;

  const [item] = await db.update(mediaLibraryItems).set(update).where(and(
    eq(mediaLibraryItems.storeId, actor.storeId),
    eq(mediaLibraryItems.id, input.id),
    isNull(mediaLibraryItems.deletedAt),
  )).returning({ id: mediaLibraryItems.id });
  if (!item) throw new MediaLibraryError("errors.notFound", 404);
  return item;
}

export async function deleteMediaLibraryItem(actor: MediaActor, candidateId: string) {
  requireManagerActor(actor);
  const parsedId = canonicalUuidCoordinateSchema.safeParse(candidateId);
  if (!parsedId.success) throw new MediaLibraryError("errors.notFound", 404);

  return db.transaction(async (transaction) => {
    const [item] = await transaction.select({
      id: mediaLibraryItems.id,
      mediaId: mediaLibraryItems.mediaObjectId,
    }).from(mediaLibraryItems).where(and(
      eq(mediaLibraryItems.storeId, actor.storeId),
      eq(mediaLibraryItems.id, parsedId.data),
      isNull(mediaLibraryItems.deletedAt),
    )).limit(1).for("update");
    if (!item) throw new MediaLibraryError("errors.notFound", 404);

    const deletedAt = new Date();
    await transaction.update(mediaLibraryItems).set({
      deletedAt,
      updatedAt: deletedAt,
    }).where(and(
      eq(mediaLibraryItems.storeId, actor.storeId),
      eq(mediaLibraryItems.id, item.id),
      isNull(mediaLibraryItems.deletedAt),
    ));

    const media = await softDeleteMediaIfUnreferencedInTransaction(transaction, {
      storeId: actor.storeId,
      mediaId: item.mediaId,
      expectedPurpose: "library-asset",
      expectedTargetId: actor.storeId,
      deletedAt,
    });
    if (media.outcome === "conflict") {
      throw new MediaLibraryError("media.deleteConflict", 409);
    }
    return { id: item.id, storagePending: media.outcome === "deleted" };
  });
}
