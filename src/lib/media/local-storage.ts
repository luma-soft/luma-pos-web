import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, open, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getLocalMediaConfig, type LocalMediaConfig } from "@/lib/media/config";
import {
  ObjectStorageWriteError,
  type MediaObjectHead,
  type ObjectStorage,
} from "@/lib/media/types";

const MAX_LOCAL_UPLOAD_BYTES = 512 * 1024 * 1024;
const SAFE_BUCKET = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SAFE_CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

type LocalToken = {
  version: 1;
  operation: "upload" | "download";
  bucket: string;
  key: string;
  expiresAt: number;
  contentType?: string;
  contentLength?: number;
  downloadFileName?: string;
};

type ObjectMetadata = { contentType: string; sizeBytes: number };

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function isExists(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EEXIST");
}

export class LocalFileObjectStorage implements ObjectStorage {
  constructor(private readonly config: LocalMediaConfig = getLocalMediaConfig()) {}

  private objectPath(bucket: string, key: string) {
    if (!SAFE_BUCKET.test(bucket)) throw new Error("Invalid local media bucket");
    const segments = key.split("/");
    if (segments.length < 1 || segments.some((segment) =>
      !segment || segment === "." || segment === ".." ||
      segment.includes("\\") || segment.includes("\0") || segment.includes("%")
    )) throw new Error("Invalid local media key");
    const bucketPath = path.resolve(this.config.root, bucket);
    const objectPath = path.resolve(bucketPath, ...segments);
    if (!objectPath.startsWith(`${bucketPath}${path.sep}`)) {
      throw new Error("Local media key escapes its bucket");
    }
    return objectPath;
  }

  private metadataPath(objectPath: string) {
    return `${objectPath}.lumapos-meta.json`;
  }

  private async saveMetadata(objectPath: string, metadata: ObjectMetadata) {
    await writeFile(this.metadataPath(objectPath), JSON.stringify(metadata), {
      mode: 0o600,
    });
  }

  private tokenUrl(pathname: string, token: LocalToken) {
    const encoded = Buffer.from(JSON.stringify(token)).toString("base64url");
    const signature = createHmac("sha256", this.config.signingSecret)
      .update(encoded)
      .digest("base64url");
    const url = new URL(pathname, this.config.publicBaseUrl);
    url.searchParams.set("token", `${encoded}.${signature}`);
    return url.toString();
  }

  verifyToken(value: string | null, operation: LocalToken["operation"]): LocalToken | null {
    if (!value || value.length > 4_096) return null;
    const separator = value.lastIndexOf(".");
    if (separator < 1) return null;
    const encoded = value.slice(0, separator);
    const suppliedSignature = value.slice(separator + 1);
    const expectedSignature = createHmac("sha256", this.config.signingSecret)
      .update(encoded)
      .digest();
    let decodedSignature: Buffer;
    try {
      decodedSignature = Buffer.from(suppliedSignature, "base64url");
    } catch {
      return null;
    }
    if (decodedSignature.length !== expectedSignature.length
      || !timingSafeEqual(decodedSignature, expectedSignature)) return null;

    try {
      const token = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LocalToken;
      if (
        token.version !== 1 || token.operation !== operation ||
        !Number.isSafeInteger(token.expiresAt) || token.expiresAt <= Date.now() ||
        !SAFE_BUCKET.test(token.bucket) ||
        typeof token.key !== "string" || !token.key ||
        (token.contentType !== undefined && !SAFE_CONTENT_TYPE.test(token.contentType)) ||
        (token.contentLength !== undefined &&
          (!Number.isSafeInteger(token.contentLength) || token.contentLength < 1 || token.contentLength > MAX_LOCAL_UPLOAD_BYTES))
      ) return null;
      this.objectPath(token.bucket, token.key);
      return token;
    } catch {
      return null;
    }
  }

  async put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    ifNoneMatch?: "*";
    signal?: AbortSignal;
  }): Promise<MediaObjectHead> {
    const objectPath = this.objectPath(input.bucket, input.key);
    if (input.body.byteLength > MAX_LOCAL_UPLOAD_BYTES || !SAFE_CONTENT_TYPE.test(input.contentType)) {
      throw new ObjectStorageWriteError("Local media upload is invalid", "definitive-no-write");
    }
    await mkdir(path.dirname(objectPath), { recursive: true, mode: 0o700 });
    try {
      await writeFile(objectPath, input.body, {
        flag: input.ifNoneMatch === "*" ? "wx" : "w",
        mode: 0o600,
        signal: input.signal,
      });
      await this.saveMetadata(objectPath, { contentType: input.contentType, sizeBytes: input.body.byteLength });
      return { sizeBytes: input.body.byteLength, contentType: input.contentType, etag: null };
    } catch (error) {
      if (isExists(error)) throw new ObjectStorageWriteError("Local media object already exists", "definitive-no-write", { cause: error });
      throw new ObjectStorageWriteError("Local media write failed", "ambiguous", { cause: error });
    }
  }

  async putRequestBody(input: {
    bucket: string;
    key: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    contentLength: number;
  }) {
    const objectPath = this.objectPath(input.bucket, input.key);
    if (!SAFE_CONTENT_TYPE.test(input.contentType)
      || !Number.isSafeInteger(input.contentLength)
      || input.contentLength < 1 || input.contentLength > MAX_LOCAL_UPLOAD_BYTES) {
      throw new ObjectStorageWriteError("Local media upload is invalid", "definitive-no-write");
    }
    await mkdir(path.dirname(objectPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${objectPath}.${randomUUID()}.upload`;
    let receivedBytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > input.contentLength) callback(new Error("UPLOAD_TOO_LARGE"));
        else callback(null, chunk);
      },
    });
    let finalCreated = false;
    try {
      await pipeline(
        Readable.fromWeb(input.body as import("node:stream/web").ReadableStream<Uint8Array>),
        limit,
        createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
      );
      if (receivedBytes !== input.contentLength) throw new Error("UPLOAD_SIZE_MISMATCH");
      await link(temporaryPath, objectPath);
      finalCreated = true;
      await this.saveMetadata(objectPath, { contentType: input.contentType, sizeBytes: receivedBytes });
      return { sizeBytes: receivedBytes, contentType: input.contentType, etag: null } satisfies MediaObjectHead;
    } catch (error) {
      if (finalCreated) {
        await rm(objectPath, { force: true }).catch(() => undefined);
        await rm(this.metadataPath(objectPath), { force: true }).catch(() => undefined);
      }
      if (isExists(error)) throw new ObjectStorageWriteError("Local media object already exists", "definitive-no-write", { cause: error });
      throw new ObjectStorageWriteError("Local media upload failed", "definitive-no-write", { cause: error });
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async get(input: { bucket: string; key: string; signal?: AbortSignal }): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.objectPath(input.bucket, input.key), { signal: input.signal }));
  }

  async getRange(input: { bucket: string; key: string; offset: number; length: number; signal?: AbortSignal }): Promise<Uint8Array> {
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.length)
      || input.length < 1 || input.length > 25 * 1024 * 1024) throw new Error("Invalid metadata range");
    const file = await open(this.objectPath(input.bucket, input.key), "r");
    try {
      const buffer = Buffer.alloc(input.length);
      const { bytesRead } = await file.read(buffer, 0, input.length, input.offset);
      return new Uint8Array(buffer.subarray(0, bytesRead));
    } finally {
      await file.close();
    }
  }

  async head(input: { bucket: string; key: string; signal?: AbortSignal }): Promise<MediaObjectHead | null> {
    const objectPath = this.objectPath(input.bucket, input.key);
    try {
      const [file, metadata] = await Promise.all([
        stat(objectPath),
        readFile(this.metadataPath(objectPath), { encoding: "utf8", signal: input.signal }).catch(() => null),
      ]);
      const decoded = metadata ? JSON.parse(metadata) as Partial<ObjectMetadata> : null;
      return {
        sizeBytes: file.size,
        contentType: typeof decoded?.contentType === "string" ? decoded.contentType : null,
        etag: null,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async createUploadUrl(input: {
    bucket: string;
    key: string;
    contentType: string;
    ifNoneMatch: "*";
    expiresInSeconds: number;
    contentLength?: number;
  }): Promise<string> {
    const contentLength = input.contentLength;
    if (!contentLength || contentLength > MAX_LOCAL_UPLOAD_BYTES || !SAFE_CONTENT_TYPE.test(input.contentType)) {
      throw new Error("Local media upload limit is invalid");
    }
    return this.tokenUrl("/api/media/local/upload", {
      version: 1,
      operation: "upload",
      bucket: input.bucket,
      key: input.key,
      contentType: input.contentType,
      contentLength,
      expiresAt: Date.now() + input.expiresInSeconds * 1_000,
    });
  }

  async createDownloadUrl(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    downloadFileName?: string;
  }): Promise<string> {
    const metadata = await this.head({ bucket: input.bucket, key: input.key });
    if (!metadata) throw new Error("Local media object not found");
    return this.tokenUrl("/api/media/local/download", {
      version: 1,
      operation: "download",
      bucket: input.bucket,
      key: input.key,
      contentType: metadata.contentType ?? "application/octet-stream",
      ...(input.downloadFileName ? { downloadFileName: input.downloadFileName.slice(0, 200) } : {}),
      expiresAt: Date.now() + input.expiresInSeconds * 1_000,
    });
  }

  async remove(input: { bucket: string; key: string }): Promise<void> {
    const objectPath = this.objectPath(input.bucket, input.key);
    await Promise.all([
      unlink(objectPath).catch((error) => { if (!isMissing(error)) throw error; }),
      unlink(this.metadataPath(objectPath)).catch((error) => { if (!isMissing(error)) throw error; }),
    ]);
  }

  publicUrl(input: { key: string }): string {
    return `${this.config.publicBaseUrl}/api/media/local/public/${input.key.split("/").map(encodeURIComponent).join("/")}`;
  }

  createReadStream(input: { bucket: string; key: string }) {
    return createReadStream(this.objectPath(input.bucket, input.key));
  }
}

let localStorage: LocalFileObjectStorage | null = null;

export function getLocalFileStorage() {
  localStorage ??= new LocalFileObjectStorage();
  return localStorage;
}
