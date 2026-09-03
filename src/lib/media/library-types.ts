import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";
import type { MediaLibraryPreset, MediaLibrarySource } from "@/lib/media/library-source-types";

export type MediaLibraryAlbum = {
  name: string;
  count: number;
  key?: string;
  system?: boolean;
  source?: MediaLibraryPreset;
};

export type MediaLibraryItem = {
  id: string;
  mediaId: string;
  album: string;
  title: string;
  note: string | null;
  tags: string[];
  kind: "image" | "video" | "document";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  creatorName: string | null;
  url: string;
  thumbnailUrl: string | null;
  metadata?: MediaFileMetadata | null;
  source?: MediaLibrarySource;
  canDelete?: boolean;
  canExtractMetadata?: boolean;
  sizeKnown?: boolean;
  uploadedAt?: string | null;
};

export type MediaLibrarySnapshot = {
  items: MediaLibraryItem[];
  albums: MediaLibraryAlbum[];
  usage: {
    libraryBytes: number;
    libraryObjects: number;
    totalBytes: number;
    totalObjects: number;
  };
  canManage: boolean;
  page?: {
    nextCursor: string | null;
    hasMore: boolean;
    totalItems: number;
  };
};
