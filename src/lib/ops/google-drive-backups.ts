import "server-only";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { access, chmod, lstat, realpath } from "node:fs/promises";
import path from "node:path";

const GOOGLE_DRIVE_ARCHIVE_PREFIX = "google-drive/";
const ARCHIVE_KEY_PATTERN = /^google-drive\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/lumapos-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.lumaenc$/i;
const MAX_RCLONE_OUTPUT_BYTES = 64 * 1024;
const REMOTE_PROBE_CACHE_MS = 30_000;

type GoogleDriveBackupConfig = {
  remoteRoot: string;
  configPath: string;
  stagingRoot: string;
  rcloneBin: string;
};

type RcloneFileInfo = {
  IsDir?: boolean;
  Size?: number;
  Hashes?: Record<string, string>;
};

export type GoogleDriveBackupReadiness = {
  configured: boolean;
  blockers: string[];
};

let remoteProbeCache: { checkedAt: number; key: string; ok: boolean } | null = null;

function isAbsolute(value: string | undefined) {
  return Boolean(value?.trim() && path.isAbsolute(value.trim()));
}

function parseRemoteRoot(value: string | undefined): string | null {
  const remote = value?.trim() ?? "";
  const separator = remote.indexOf(":");
  if (separator <= 0) return null;
  const name = remote.slice(0, separator);
  const folderPath = remote.slice(separator + 1).replace(/\/+$/, "");
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !folderPath || folderPath.startsWith("/")) return null;
  const segments = folderPath.split("/");
  if (segments.some((segment) =>
    !segment || segment === "." || segment === ".." || segment.startsWith("-")
    || segment.includes("\\") || /[\u0000-\u001f\u007f]/.test(segment)
  )) return null;
  return `${name}:${segments.join("/")}`;
}

function getConfig(env: NodeJS.ProcessEnv = process.env): { config: GoogleDriveBackupConfig | null; blockers: string[] } {
  const blockers: string[] = [];
  const remoteRoot = parseRemoteRoot(env.LUMAPOS_BACKUP_REMOTE);
  const configPath = env.LUMAPOS_RCLONE_CONFIG?.trim();
  const stagingRoot = env.LUMAPOS_BACKUP_STAGING_ROOT?.trim();
  const rcloneBin = env.LUMAPOS_RCLONE_BIN?.trim() || "rclone";

  if (env.LUMAPOS_BACKUP_PROVIDER?.trim().toLowerCase() !== "google-drive") {
    blockers.push("providerConfiguration");
  }
  if (!remoteRoot) blockers.push("driveConfiguration");
  if (!isAbsolute(configPath)) blockers.push("rcloneConfiguration");
  if (!isAbsolute(stagingRoot)) blockers.push("stagingRootConfiguration");
  if (!rcloneBin || /[\u0000-\u001f\u007f]/.test(rcloneBin)) blockers.push("rcloneUnavailable");
  if (blockers.length > 0 || !remoteRoot || !configPath || !stagingRoot) {
    return { config: null, blockers };
  }

  return {
    config: {
      remoteRoot,
      configPath: path.resolve(configPath),
      stagingRoot: path.resolve(stagingRoot),
      rcloneBin,
    },
    blockers,
  };
}

function runRclone(
  config: GoogleDriveBackupConfig,
  args: string[],
  options: { timeoutMs?: number; captureOutput?: boolean } = {},
): Promise<string> {
  const captureOutput = options.captureOutput ?? false;
  return new Promise((resolve, reject) => {
    const child = spawn(config.rcloneBin, [
      "--config", config.configPath,
      "--ask-password=false",
      ...args,
    ], {
      env: {
        ...process.env,
        RCLONE_CONFIG: config.configPath,
        RCLONE_ASK_PASSWORD: "false",
      },
      stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
    });
    let output = "";
    let timedOut = false;
    let outputTooLarge = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs)
      : null;

    child.stdout?.on("data", (chunk: Buffer) => {
      if (!captureOutput) return;
      if (Buffer.byteLength(output) + chunk.byteLength > MAX_RCLONE_OUTPUT_BYTES) {
        outputTooLarge = true;
        child.kill("SIGTERM");
        return;
      }
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      if (timeout) clearTimeout(timeout);
      reject(new Error("RCLONE_COMMAND_UNAVAILABLE"));
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) return reject(new Error("RCLONE_COMMAND_TIMEOUT"));
      if (outputTooLarge) return reject(new Error("RCLONE_OUTPUT_TOO_LARGE"));
      if (code !== 0) return reject(new Error("RCLONE_COMMAND_FAILED"));
      resolve(output);
    });
  });
}

function getRemoteArchivePath(remoteRoot: string, archiveKey: unknown) {
  if (typeof archiveKey !== "string" || !ARCHIVE_KEY_PATTERN.test(archiveKey)) return null;
  return `${remoteRoot}/${archiveKey.slice(GOOGLE_DRIVE_ARCHIVE_PREFIX.length)}`;
}

async function readRemoteFileInfo(config: GoogleDriveBackupConfig, remotePath: string): Promise<RcloneFileInfo> {
  const output = await runRclone(config, [
    "lsjson",
    "--stat",
    "--hash",
    "--hash-type", "MD5",
    "--no-mimetype",
    "--no-modtime",
    remotePath,
  ], { timeoutMs: 15_000, captureOutput: true });
  return JSON.parse(output) as RcloneFileInfo;
}

function md5Hash(info: RcloneFileInfo) {
  const entry = Object.entries(info.Hashes ?? {})
    .find(([name]) => name.toLowerCase() === "md5");
  return entry?.[1]?.toLowerCase() ?? null;
}

async function md5File(filePath: string) {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function checkPrivateFile(filePath: string) {
  try {
    const file = await lstat(filePath);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) return false;
    await access(filePath, fsConstants.R_OK | fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function pathsOverlap(first: string, second: string) {
  return first === second
    || first.startsWith(`${second}${path.sep}`)
    || second.startsWith(`${first}${path.sep}`);
}

async function checkPrivateStagingRoot(
  config: GoogleDriveBackupConfig,
  input: { applicationRoot?: string; mediaRoot?: string | null },
) {
  try {
    const root = await lstat(config.stagingRoot);
    if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o077) !== 0) {
      return "stagingRootNotPrivate";
    }
    await access(config.stagingRoot, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
    const canonicalRoot = await realpath(config.stagingRoot);
    const applicationRoot = input.applicationRoot ? await realpath(input.applicationRoot) : null;
    const mediaRoot = input.mediaRoot ? await realpath(input.mediaRoot) : null;
    if (applicationRoot && pathsOverlap(canonicalRoot, applicationRoot)) return "stagingRootInsideApplication";
    if (mediaRoot && pathsOverlap(canonicalRoot, mediaRoot)) return "stagingRootInsideMedia";
    return null;
  } catch {
    return "stagingRootUnavailable";
  }
}

export async function readGoogleDriveBackupReadiness(input: {
  applicationRoot?: string;
  mediaRoot?: string | null;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<GoogleDriveBackupReadiness> {
  const { config, blockers } = getConfig(input.env);
  if (!config) return { configured: false, blockers };

  const stagingBlocker = await checkPrivateStagingRoot(config, input);
  if (stagingBlocker) blockers.push(stagingBlocker);
  if (!await checkPrivateFile(config.configPath)) blockers.push("rcloneConfigurationUnavailable");
  if (blockers.length > 0) return { configured: false, blockers };

  const cacheKey = `${config.rcloneBin}\n${config.configPath}\n${config.remoteRoot}`;
  const now = Date.now();
  if (remoteProbeCache?.key === cacheKey && now - remoteProbeCache.checkedAt < REMOTE_PROBE_CACHE_MS) {
    return remoteProbeCache.ok
      ? { configured: true, blockers: [] }
      : { configured: false, blockers: ["driveUnavailable"] };
  }

  let ok = false;
  try {
    await runRclone(config, ["lsf", "--max-depth", "1", config.remoteRoot], { timeoutMs: 15_000 });
    ok = true;
  } catch {
    ok = false;
  }
  remoteProbeCache = { checkedAt: now, key: cacheKey, ok };
  return ok
    ? { configured: true, blockers: [] }
    : { configured: false, blockers: ["driveUnavailable"] };
}

export async function verifyGoogleDriveBackupArchive(input: {
  archiveKey: unknown;
  archiveSizeBytes: unknown;
  archiveSha256: unknown;
  archiveMd5: unknown;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const { config } = getConfig(input.env);
  const remotePath = config ? getRemoteArchivePath(config.remoteRoot, input.archiveKey) : null;
  const expectedSize = Number(input.archiveSizeBytes);
  const expectedMd5 = typeof input.archiveMd5 === "string" ? input.archiveMd5.toLowerCase() : "";
  if (
    !config || !remotePath
    || !Number.isSafeInteger(expectedSize) || expectedSize <= 0
    || typeof input.archiveSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(input.archiveSha256)
    || !/^[0-9a-f]{32}$/.test(expectedMd5)
  ) return false;

  try {
    const info = await readRemoteFileInfo(config, remotePath);
    return info.IsDir !== true
      && info.Size === expectedSize
      && md5Hash(info) === expectedMd5;
  } catch {
    return false;
  }
}

export async function uploadGoogleDriveBackupArchive(input: {
  localPath: string;
  archiveKey: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ sizeBytes: number; md5: string }> {
  const { config, blockers } = getConfig(input.env);
  const remotePath = config ? getRemoteArchivePath(config.remoteRoot, input.archiveKey) : null;
  if (!config || !remotePath || blockers.length > 0) throw new Error("BACKUP_DESTINATION_NOT_READY");

  const localInfo = await lstat(input.localPath);
  if (!localInfo.isFile() || localInfo.isSymbolicLink() || localInfo.size <= 0) {
    throw new Error("BACKUP_ARCHIVE_INVALID");
  }
  const expectedMd5 = await md5File(input.localPath);
  await runRclone(config, ["copyto", "--immutable", input.localPath, remotePath], { timeoutMs: 30 * 60_000 });
  const uploadedInfo = await readRemoteFileInfo(config, remotePath);
  if (uploadedInfo.IsDir === true || uploadedInfo.Size !== localInfo.size || md5Hash(uploadedInfo) !== expectedMd5) {
    throw new Error("GOOGLE_DRIVE_ARCHIVE_VERIFY_FAILED");
  }
  return { sizeBytes: localInfo.size, md5: expectedMd5 };
}

export async function downloadGoogleDriveBackupArchive(input: {
  archiveKey: string;
  destinationPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const { config, blockers } = getConfig(input.env);
  const remotePath = config ? getRemoteArchivePath(config.remoteRoot, input.archiveKey) : null;
  if (!config || !remotePath || blockers.length > 0) throw new Error("BACKUP_DESTINATION_NOT_READY");

  await runRclone(config, ["copyto", remotePath, input.destinationPath], { timeoutMs: 30 * 60_000 });
  await chmod(input.destinationPath, 0o600);
}

export function isGoogleDriveArchiveKey(value: unknown): boolean {
  return typeof value === "string" && ARCHIVE_KEY_PATTERN.test(value);
}
