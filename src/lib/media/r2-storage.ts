import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getR2Config, type R2Config } from "@/lib/media/config";
import type { MediaObjectHead, ObjectStorage } from "@/lib/media/types";

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404
  );
}

function publicObjectUrl(baseUrl: string, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/${encodedKey}`;
}

export class R2ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: R2Config = getR2Config()) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<MediaObjectHead> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return {
      sizeBytes: input.body.byteLength,
      contentType: input.contentType,
      etag: result.ETag ?? null,
    };
  }

  async get(input: { bucket: string; key: string }): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
    if (!result.Body) throw new Error("R2 object response is missing a body");
    return result.Body.transformToByteArray();
  }

  async head(input: {
    bucket: string;
    key: string;
  }): Promise<MediaObjectHead | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      return {
        sizeBytes: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
        etag: result.ETag ?? null,
      };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  createUploadUrl(input: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  createDownloadUrl(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async remove(input: { bucket: string; key: string }): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
    );
  }

  publicUrl(input: { key: string }): string {
    return publicObjectUrl(this.config.publicBaseUrl, input.key);
  }
}
