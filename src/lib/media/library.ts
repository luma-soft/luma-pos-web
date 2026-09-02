import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { mediaLibraryItems, mediaObjects, profiles } from "@/db/schema";
import type { MediaActor } from "@/lib/media/authorization";
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
import { canonicalUuidCoordinateSchema } from "@/lib/media/uuid-coordinate";

const LIBRARY_SIGNED_URL_SECONDS = 15 * 60;
const LIBRARY_LIST_LIMIT = 1_000;

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
  return error instanceof MediaLibraryError
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
): Promise<MediaLibrarySnapshot> {
  const [rows, totalUsage, libraryUsage] = await Promise.all([
    db.select({
      id: mediaLibraryItems.id,
      mediaId: mediaLibraryItems.mediaObjectId,
      album: mediaLibraryItems.album,
      title: mediaLibraryItems.title,
      note: mediaLibraryItems.note,
      tags: mediaLibraryItems.tags,
      createdAt: mediaLibraryItems.createdAt,
      creatorName: profiles.fullName,
      provider: mediaObjects.provider,
      bucket: mediaObjects.bucket,
      objectKey: mediaObjects.objectKey,
      thumbnailObjectKey: mediaObjects.thumbnailObjectKey,
      fileName: mediaObjects.originalFileName,
      mimeType: mediaObjects.mimeType,
      sizeBytes: mediaObjects.sizeBytes,
    }).from(mediaLibraryItems)
      .innerJoin(mediaObjects, and(
        eq(mediaObjects.storeId, mediaLibraryItems.storeId),
        eq(mediaObjects.id, mediaLibraryItems.mediaObjectId),
      ))
      .leftJoin(profiles, and(
        eq(profiles.storeId, mediaLibraryItems.storeId),
        eq(profiles.id, mediaLibraryItems.createdBy),
      ))
      .where(and(
        eq(mediaLibraryItems.storeId, actor.storeId),
        isNull(mediaLibraryItems.deletedAt),
        eq(mediaObjects.status, "ready"),
        eq(mediaObjects.purpose, "library-asset"),
        eq(mediaObjects.targetId, actor.storeId),
      ))
      .orderBy(desc(mediaLibraryItems.createdAt))
      .limit(LIBRARY_LIST_LIMIT),
    db.select({
      bytes: sql<string>`coalesce(sum(${mediaObjects.sizeBytes} + coalesce(${mediaObjects.thumbnailSizeBytes}, 0)), 0)::text`,
      objects: sql<number>`count(*)::int`,
    }).from(mediaObjects).where(and(
      eq(mediaObjects.storeId, actor.storeId),
      eq(mediaObjects.status, "ready"),
    )),
    db.select({
      bytes: sql<string>`coalesce(sum(${mediaObjects.sizeBytes} + coalesce(${mediaObjects.thumbnailSizeBytes}, 0)), 0)::text`,
      objects: sql<number>`count(*)::int`,
    }).from(mediaLibraryItems).innerJoin(mediaObjects, and(
      eq(mediaObjects.storeId, mediaLibraryItems.storeId),
      eq(mediaObjects.id, mediaLibraryItems.mediaObjectId),
    )).where(and(
      eq(mediaLibraryItems.storeId, actor.storeId),
      isNull(mediaLibraryItems.deletedAt),
      eq(mediaObjects.status, "ready"),
    )),
  ]);

  const items = await Promise.all(rows.map(async (row): Promise<MediaLibraryItem> => {
    const kind = mediaLibraryKindForMime(row.mimeType);
    if (!kind) throw new MediaLibraryError("errors.invalidData", 500);
    const storage = getObjectStorage(row.provider);
    const [url, thumbnailUrl] = await Promise.all([
      storage.createDownloadUrl({
        bucket: row.bucket,
        key: row.objectKey,
        expiresInSeconds: LIBRARY_SIGNED_URL_SECONDS,
      }),
      row.thumbnailObjectKey
        ? storage.createDownloadUrl({
            bucket: row.bucket,
            key: row.thumbnailObjectKey,
            expiresInSeconds: LIBRARY_SIGNED_URL_SECONDS,
          })
        : Promise.resolve(null),
    ]);
    return {
      id: row.id,
      mediaId: row.mediaId,
      album: row.album,
      title: row.title,
      note: row.note,
      tags: row.tags,
      kind,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      creatorName: row.creatorName,
      url,
      thumbnailUrl,
    };
  }));

  const albumCounts = new Map<string, number>();
  for (const item of items) {
    albumCounts.set(item.album, (albumCounts.get(item.album) ?? 0) + 1);
  }

  return {
    items,
    albums: [...albumCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "vi"))
      .map(([name, count]) => ({ name, count })),
    usage: {
      libraryBytes: Number(libraryUsage[0]?.bytes ?? 0),
      libraryObjects: libraryUsage[0]?.objects ?? 0,
      totalBytes: Number(totalUsage[0]?.bytes ?? 0),
      totalObjects: totalUsage[0]?.objects ?? 0,
    },
    canManage: actor.role === "owner" || actor.role === "manager",
  };
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
