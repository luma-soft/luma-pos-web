import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

export type BackupR2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export function getBackupR2Config(env: NodeJS.ProcessEnv = process.env): BackupR2Config {
  const accountId = env.LUMAPOS_BACKUP_R2_ACCOUNT_ID?.trim() ?? "";
  const accessKeyId = env.LUMAPOS_BACKUP_R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.LUMAPOS_BACKUP_R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucket = env.LUMAPOS_BACKUP_R2_BUCKET?.trim() ?? "";

  if (!/^[0-9a-f]{32}$/i.test(accountId)) {
    throw new Error("LUMAPOS_BACKUP_R2_ACCOUNT_ID is invalid");
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("LUMAPOS_BACKUP_R2 credentials are missing");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("LUMAPOS_BACKUP_R2_BUCKET is invalid");
  }

  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function isBackupR2Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    getBackupR2Config(env);
    return true;
  } catch {
    return false;
  }
}

export function createBackupR2Client(config: BackupR2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function uploadEncryptedBackup(input: {
  client: S3Client;
  config: BackupR2Config;
  filePath: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
}) {
  await input.client.send(new PutObjectCommand({
    Bucket: input.config.bucket,
    Key: input.objectKey,
    Body: createReadStream(input.filePath),
    ContentLength: input.sizeBytes,
    ContentType: "application/vnd.lumapos.encrypted-backup",
    Metadata: {
      format: "lumapos-backup-v1",
      sha256: input.sha256,
    },
  }));

  const head = await input.client.send(new HeadObjectCommand({
    Bucket: input.config.bucket,
    Key: input.objectKey,
  }));
  if (head.ContentLength !== input.sizeBytes || head.Metadata?.sha256 !== input.sha256) {
    throw new Error("BACKUP_R2_VERIFY_FAILED");
  }

  const remote = await input.client.send(new GetObjectCommand({
    Bucket: input.config.bucket,
    Key: input.objectKey,
  }));
  if (!remote.Body) throw new Error("BACKUP_R2_VERIFY_FAILED");
  const hash = createHash("sha256");
  let remoteSizeBytes = 0;
  for await (const chunk of remote.Body as Readable) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    remoteSizeBytes += bytes.byteLength;
  }
  if (remoteSizeBytes !== input.sizeBytes || hash.digest("hex") !== input.sha256) {
    throw new Error("BACKUP_R2_VERIFY_FAILED");
  }
  return head;
}

export async function downloadEncryptedBackup(input: {
  client: S3Client;
  config: BackupR2Config;
  objectKey: string;
  destinationPath: string;
}) {
  if (!/^database-backups\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/lumapos-[0-9a-f-]{36}\.lumaenc$/i.test(input.objectKey)) {
    throw new Error("Backup object key is not in the supported LumaPOS backup namespace");
  }

  const response = await input.client.send(new GetObjectCommand({
    Bucket: input.config.bucket,
    Key: input.objectKey,
  }));
  if (!response.Body) throw new Error("Backup object is empty");

  await mkdir(path.dirname(input.destinationPath), { recursive: true, mode: 0o700 });
  try {
    await pipeline(
      response.Body as Readable,
      createWriteStream(input.destinationPath, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await rm(input.destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    sizeBytes: response.ContentLength ?? null,
    sha256: response.Metadata?.sha256 ?? null,
  };
}
