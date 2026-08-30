import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  ObjectStorageOperationUnsupportedError,
  type MediaObjectHead,
  type ObjectStorage,
} from "@/lib/media/types";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: number | string;
    statusCode?: number | string;
  };
  return candidate.status === 404 || candidate.status === "404" ||
    candidate.statusCode === 404 || candidate.statusCode === "404";
}

export class SupabaseObjectStorage implements ObjectStorage {
  constructor(
    private readonly publicBucket = "products",
    private readonly supabase: SupabaseAdminClient = createSupabaseAdminClient(),
  ) {}

  async put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<MediaObjectHead> {
    const { error } = await this.supabase.storage
      .from(input.bucket)
      .upload(input.key, input.body, {
        contentType: input.contentType,
        upsert: false,
      });
    if (error) throw error;
    return {
      sizeBytes: input.body.byteLength,
      contentType: input.contentType,
      etag: null,
    };
  }

  async get(input: { bucket: string; key: string }): Promise<Uint8Array> {
    const { data, error } = await this.supabase.storage
      .from(input.bucket)
      .download(input.key);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  }

  async head(input: {
    bucket: string;
    key: string;
  }): Promise<MediaObjectHead | null> {
    const { data, error } = await this.supabase.storage
      .from(input.bucket)
      .info(input.key);
    if (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
    return {
      sizeBytes: data.size ?? 0,
      contentType: data.contentType ?? null,
      etag: data.etag ?? null,
    };
  }

  async createUploadUrl(input: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    void input;
    throw new ObjectStorageOperationUnsupportedError(
      "supabase",
      "createUploadUrl",
    );
  }

  async createDownloadUrl(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(input.bucket)
      .createSignedUrl(input.key, input.expiresInSeconds);
    if (error) throw error;
    return data.signedUrl;
  }

  async remove(input: { bucket: string; key: string }): Promise<void> {
    const { error } = await this.supabase.storage
      .from(input.bucket)
      .remove([input.key]);
    if (error) throw error;
  }

  publicUrl(input: { key: string }): string {
    return this.supabase.storage.from(this.publicBucket).getPublicUrl(input.key)
      .data.publicUrl;
  }
}
