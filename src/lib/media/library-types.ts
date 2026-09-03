import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";

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
};

export type MediaLibrarySnapshot = {
  items: MediaLibraryItem[];
  albums: Array<{ name: string; count: number }>;
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
