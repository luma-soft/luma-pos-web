export type MediaProvider = "r2" | "supabase";

export type MediaVisibility = "public" | "private";

export type MediaObjectHead = {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
};

export class ObjectStorageOperationUnsupportedError extends Error {
  readonly code = "OBJECT_STORAGE_OPERATION_UNSUPPORTED";

  constructor(
    readonly provider: MediaProvider,
    readonly operation: "createUploadUrl",
  ) {
    super(`${provider} object storage does not support ${operation}`);
    this.name = "ObjectStorageOperationUnsupportedError";
  }
}

export interface ObjectStorage {
  put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<MediaObjectHead>;
  get(input: { bucket: string; key: string }): Promise<Uint8Array>;
  head(input: {
    bucket: string;
    key: string;
  }): Promise<MediaObjectHead | null>;
  createUploadUrl(input: {
    bucket: string;
    key: string;
    contentType: string;
    ifNoneMatch: "*";
    expiresInSeconds: number;
  }): Promise<string>;
  createDownloadUrl(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
  }): Promise<string>;
  remove(input: { bucket: string; key: string }): Promise<void>;
  publicUrl(input: { key: string }): string;
}
