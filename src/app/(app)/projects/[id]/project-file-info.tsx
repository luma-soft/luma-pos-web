"use client";

import { FileInfoPanel, type FileInfoDetails } from "@/components/media/file-info-panel";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";
import type { ProjectMediaItem } from "./project-media-panel";

type MetadataDescriptor = {
  metadata?: MediaFileMetadata | null;
  creatorName?: string | null;
  canExtractMetadata?: boolean;
};

async function requestMetadata(mediaId: string, extract: boolean, signal: AbortSignal, fetcher: typeof fetch) {
  const response = await fetcher(`/api/mobile/media/${encodeURIComponent(mediaId)}${extract ? "/metadata" : ""}`, {
    method: extract ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const body = await response.json() as { ok?: boolean; data?: MetadataDescriptor };
  if (!response.ok || !body.ok || !body.data || typeof body.data !== "object") {
    throw new Error("FILE_METADATA_REQUEST_FAILED");
  }
  return body.data;
}

export async function loadProjectFileInfo(mediaId: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FileInfoDetails> {
  const data = await requestMetadata(mediaId, false, signal, fetcher);
  return { metadata: data.metadata ?? null, uploaderName: data.creatorName,
    canExtractMetadata: typeof data.canExtractMetadata === "boolean" ? data.canExtractMetadata : undefined };
}

export async function extractProjectFileMetadata(mediaId: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<MediaFileMetadata | null> {
  return (await requestMetadata(mediaId, true, signal, fetcher)).metadata ?? null;
}

export function ProjectFileInfo({ item, canManage }: {
  item: Pick<ProjectMediaItem, "mediaId" | "fileName" | "mimeType" | "sizeBytes" | "createdAt" | "creatorName" | "metadata"> & Partial<ProjectMediaItem>;
  canManage: boolean;
}) {
  return <FileInfoPanel
    key={item.mediaId}
    fileName={item.fileName}
    mimeType={item.mimeType}
    sizeBytes={item.sizeBytes}
    uploadedAt={item.createdAt}
    uploaderName={item.creatorName}
    metadata={item.metadata}
    canManage={canManage}
    onLoad={(signal) => loadProjectFileInfo(item.mediaId, signal)}
    onExtract={(signal) => extractProjectFileMetadata(item.mediaId, signal)}
  />;
}
