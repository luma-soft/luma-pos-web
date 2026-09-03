import { z } from "zod";

import { canonicalUuidCoordinateSchema } from "@/lib/media/uuid-coordinate";

export const MEDIA_LIBRARY_UNCLASSIFIED_ALBUM = "Chưa phân loại";
export const LIBRARY_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const LIBRARY_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
export const LIBRARY_VIDEO_MAX_BYTES = 512 * 1024 * 1024;

export const MEDIA_LIBRARY_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
const LIBRARY_IMAGE_TYPES = new Set<string>(MEDIA_LIBRARY_IMAGE_MIME_TYPES);

const LIBRARY_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
]);

const LIBRARY_DOCUMENT_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/plain",
]);

export type MediaLibraryKind = "image" | "video" | "document";

export function mediaLibraryKindForMime(mimeType: string): MediaLibraryKind | null {
  const normalized = mimeType.trim().toLowerCase();
  if (LIBRARY_IMAGE_TYPES.has(normalized)) return "image";
  if (LIBRARY_VIDEO_TYPES.has(normalized)) return "video";
  if (LIBRARY_DOCUMENT_TYPES.has(normalized)) return "document";
  return null;
}

export function mediaLibraryMaxBytesForMime(mimeType: string): number | null {
  switch (mediaLibraryKindForMime(mimeType)) {
    case "image":
      return LIBRARY_IMAGE_MAX_BYTES;
    case "video":
      return LIBRARY_VIDEO_MAX_BYTES;
    case "document":
      return LIBRARY_DOCUMENT_MAX_BYTES;
    default:
      return null;
  }
}

const albumSchema = z.string().trim().max(80).transform((value) =>
  value || MEDIA_LIBRARY_UNCLASSIFIED_ALBUM
);
const titleSchema = z.string().trim().min(1).max(160);
const optionalNoteSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(500).nullable().optional(),
);
const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(12)
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLocaleLowerCase("vi");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

export const mediaLibraryItemInputSchema = z.object({
  mediaId: canonicalUuidCoordinateSchema,
  album: albumSchema,
  title: titleSchema,
  note: optionalNoteSchema.transform((value) => value ?? null),
  tags: z.preprocess(
    (value) => Array.isArray(value)
      ? value.filter((tag) => typeof tag === "string" && tag.trim().length > 0)
      : value,
    tagsSchema.optional(),
  ).transform((tags) => tags ?? []),
});

export const mediaLibraryItemPatchSchema = z.object({
  id: canonicalUuidCoordinateSchema,
  album: albumSchema.optional(),
  title: titleSchema.optional(),
  note: optionalNoteSchema,
  tags: z.preprocess(
    (value) => Array.isArray(value)
      ? value.filter((tag) => typeof tag === "string" && tag.trim().length > 0)
      : value,
    tagsSchema.optional(),
  ),
}).refine(
  (value) => value.album !== undefined
    || value.title !== undefined
    || value.note !== undefined
    || value.tags !== undefined,
  { message: "At least one library field is required" },
);

export type MediaLibraryItemInput = z.infer<typeof mediaLibraryItemInputSchema>;
export type MediaLibraryItemPatch = z.infer<typeof mediaLibraryItemPatchSchema>;
