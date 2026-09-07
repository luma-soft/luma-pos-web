"use client";

import { zip } from "fflate";

import type { MediaLibraryItem } from "@/lib/media/library-types";

export type PreparedLibraryImages = {
  files: File[];
  failed: number;
};

export function safeLibraryFileName(name: string, fallback: string) {
  const clean = name
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .trim();
  return clean && clean !== "." && clean !== ".." ? clean : fallback;
}

export async function prepareLibraryImages(
  items: readonly MediaLibraryItem[],
  onProgress?: (completed: number, total: number) => void,
): Promise<PreparedLibraryImages> {
  const files: File[] = [];
  let failed = 0;
  for (const item of items) {
    try {
      if (item.kind !== "image") throw new Error("NOT_AN_IMAGE");
      const response = await fetch(
        `/api/mobile/library?download=${encodeURIComponent(item.id)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error("IMAGE_DOWNLOAD_FAILED");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/") && item.mimeType !== "image/*") {
        throw new Error("INVALID_IMAGE_RESPONSE");
      }
      files.push(
        new File(
          [blob],
          safeLibraryFileName(item.fileName, `image-${files.length + 1}`),
          { type: blob.type || item.mimeType },
        ),
      );
    } catch {
      failed += 1;
    } finally {
      onProgress?.(files.length + failed, items.length);
    }
  }
  return { files, failed };
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createLibraryImageArchive(files: readonly File[]) {
  return new Promise<Uint8Array>((resolve, reject) => {
    Promise.all(
      files.map(async (file) => [file.name, new Uint8Array(await file.arrayBuffer())] as const),
    ).then((entries) => {
      const names = new Map<string, number>();
      const input: Record<string, Uint8Array> = {};
      for (const [originalName, bytes] of entries) {
        const seen = names.get(originalName) ?? 0;
        names.set(originalName, seen + 1);
        const dot = originalName.lastIndexOf(".");
        const name = seen === 0
          ? originalName
          : dot > 0
            ? `${originalName.slice(0, dot)}-${seen + 1}${originalName.slice(dot)}`
            : `${originalName}-${seen + 1}`;
        input[name] = bytes;
      }
      zip(input, { level: 0 }, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    }, reject);
  });
}

export async function saveLibraryImages(files: readonly File[]) {
  if (files.length === 0) return;
  if (files.length === 1) {
    saveBlob(files[0], files[0].name);
    return;
  }
  const archive = await createLibraryImageArchive(files);
  const archiveBuffer = Uint8Array.from(archive).buffer;
  saveBlob(new Blob([archiveBuffer], { type: "application/zip" }), "luma-photos.zip");
}

export async function shareLibraryImages(files: readonly File[]) {
  if (!navigator.share || !navigator.canShare?.({ files: [...files] })) {
    throw new Error("SHARE_UNAVAILABLE");
  }
  try {
    await navigator.share({ files: [...files] });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    throw error;
  }
}
