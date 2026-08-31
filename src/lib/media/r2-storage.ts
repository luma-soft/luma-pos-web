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
import {
  ObjectStorageWriteError,
  type MediaObjectHead,
  type ObjectStorage,
  type ObjectStorageWriteOutcome,
} from "@/lib/media/types";

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

export function attachmentContentDisposition(fileName: string) {
  const normalized = fileName.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const fallback = normalized
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 120) || "download";
  const encoded = encodeURIComponent(normalized || "download")
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function writeFailureOutcome(error: unknown): ObjectStorageWriteOutcome {
  if (!error || typeof error !== "object") return "ambiguous";
  const candidate = error as {
    status?: number;
    statusCode?: number;
    $metadata?: { httpStatusCode?: number };
  };
  const status = candidate.$metadata?.httpStatusCode
    ?? candidate.statusCode
    ?? candidate.status;
  return status != null && [
    400,
    401,
    403,
    404,
    405,
    409,
    411,
    412,
    413,
    415,
    422,
  ].includes(status)
    ? "definitive-no-write"
    : "ambiguous";
}

export class R2ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly config: R2Config = getR2Config(),
    client?: S3Client,
    private readonly presign: typeof getSignedUrl = getSignedUrl,
  ) {
    this.client = client ?? new S3Client({
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
    ifNoneMatch?: "*";
    signal?: AbortSignal;
  }): Promise<MediaObjectHead> {
    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          IfNoneMatch: input.ifNoneMatch,
        }),
        { abortSignal: input.signal },
      );
      return {
        sizeBytes: input.body.byteLength,
        contentType: input.contentType,
        etag: result.ETag ?? null,
      };
    } catch (error) {
      throw new ObjectStorageWriteError(
        "Object storage write failed",
        writeFailureOutcome(error),
        { cause: error },
      );
    }
  }

  async get(input: { bucket: string; key: string; signal?: AbortSignal }): Promise<Uint8Array> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      { abortSignal: input.signal },
    );
    if (!result.Body) throw new Error("R2 object response is missing a body");
    return result.Body.transformToByteArray();
  }

  async head(input: {
    bucket: string;
    key: string;
    signal?: AbortSignal;
  }): Promise<MediaObjectHead | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
        { abortSignal: input.signal },
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
    ifNoneMatch: "*";
    expiresInSeconds: number;
  }): Promise<string> {
    return this.presign(
      this.client,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
        IfNoneMatch: input.ifNoneMatch,
      }),
      {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(["content-type", "if-none-match"]),
      },
    );
  }

  createDownloadUrl(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    downloadFileName?: string;
  }): Promise<string> {
    return this.presign(
      this.client,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ResponseContentDisposition: input.downloadFileName
          ? attachmentContentDisposition(input.downloadFileName)
          : undefined,
      }),
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
