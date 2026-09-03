import { mediaLibraryItemInputSchema } from "@/lib/media/library-schema";

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
) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (album) params.set("album", album);
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
