import { mediaLibraryItemInputSchema } from "@/lib/media/library-schema";
import { MEDIA_LIBRARY_PRESETS, type MediaLibraryPreset } from "@/lib/media/library-source-types";
import type { MediaLibraryAlbum, MediaLibraryItem } from "@/lib/media/library-types";

export type LibraryAlbumSelection = { album: string; source: MediaLibraryPreset | "" };

export function libraryManualAlbums(albums: readonly MediaLibraryAlbum[]) {
  return albums.filter((entry) => !entry.system && !entry.source);
}

export function libraryAlbumKey(entry: MediaLibraryAlbum) {
  return entry.source ? `auto:${entry.source}` : `manual:${entry.key ?? entry.name}`;
}

export function libraryAlbumSelection(entry: MediaLibraryAlbum): LibraryAlbumSelection {
  return entry.source ? { album: "", source: entry.source } : { album: entry.name, source: "" };
}

export function libraryCanDelete(item: MediaLibraryItem, canManage: boolean) {
  return !item.source && (item.canDelete ?? canManage);
}

export function libraryCanExtractMetadata(item: MediaLibraryItem, canManage: boolean) {
  return item.canExtractMetadata ?? (!item.source && canManage);
}

export function libraryItemSizeKnown(item: MediaLibraryItem) {
  return item.sizeKnown ?? (!item.source || item.sizeBytes > 0);
}

export function libraryItemUploadedAt(item: MediaLibraryItem) {
  return item.uploadedAt !== undefined ? item.uploadedAt : item.source ? null : item.createdAt;
}

export function libraryItemSourcePreset(item: MediaLibraryItem) {
  return item.source ? MEDIA_LIBRARY_PRESETS.find((preset) => preset.name === item.album)?.source : undefined;
}

export function formatLibraryBytes(bytes: number, locale: string) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index =
    bytes > 0
      ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
      : 0;
  const amount = bytes / 1024 ** index;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index > 1 && amount < 10 ? 1 : 0 }).format(amount)} ${units[index]}`;
}

export function libraryFileKey(
  file: Pick<File, "name" | "size" | "lastModified">,
) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function libraryFileTitle(name: string) {
  return (name.replace(/\.[^.]+$/, "").trim() || name.trim() || "File").slice(
    0,
    160,
  );
}

export function libraryMetadataValid(
  album: string,
  note: string,
  tags: string[],
) {
  return mediaLibraryItemInputSchema.safeParse({
    mediaId: "00000000-0000-4000-8000-000000000001",
    album,
    note,
    tags,
    title: "Validation",
  }).success;
}

export function libraryListPath(
  query: string,
  album: string,
  kind: string,
  cursor?: string | null,
  source?: MediaLibraryPreset | "",
) {
  const params = new URLSearchParams({ includeSources: "1" });
  if (query.trim()) params.set("q", query.trim());
  if (source) params.set("source", source);
  else if (album) params.set("album", album);
  if (kind) params.set("kind", kind);
  if (cursor) params.set("cursor", cursor);
  return `/api/mobile/library${params.size ? `?${params}` : ""}`;
}

export async function libraryRequest<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, { credentials: "same-origin", ...init });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: T;
  } | null;
  if (!response.ok || payload?.ok !== true)
    throw new Error("MEDIA_LIBRARY_REQUEST_FAILED");
  return payload.data as T;
}
