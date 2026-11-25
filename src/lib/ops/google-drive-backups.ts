import "server-only";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { access, chmod, lstat, realpath } from "node:fs/promises";
import path from "node:path";

const GOOGLE_DRIVE_ARCHIVE_PREFIX = "google-drive/";
const ARCHIVE_KEY_PATTERN = /^google-drive\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/lumapos-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.lumaenc$/i;
const MAX_RCLONE_OUTPUT_BYTES = 64 * 1024;
const REMOTE_PROBE_CACHE_MS = 5 * 60_000;
// Readiness is polled every few seconds (Mac host console, health checks), and
// each Drive lookup through rclone takes several seconds. An uploaded archive
// is immutable, so a verified one stays verified; a failed check is retried
// after a minute.
const ARCHIVE_VERIFIED_CACHE_MS = 30 * 60_000;
const ARCHIVE_FAILED_CACHE_MS = 60_000;

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
const archiveVerificationCache = new Map<string, { checkedAt: number; result: Promise<boolean> }>();

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

// Google over IPv6 has been several times slower than IPv4 from the store
// network, so rclone binds to IPv4 unless LUMAPOS_RCLONE_BIND says otherwise
// (an address to bind to, or empty to let the system choose).
function rcloneBindArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.LUMAPOS_RCLONE_BIND;
  const bind = configured === undefined ? "0.0.0.0" : configured.trim();
  return bind ? ["--bind", bind] : [];
}

// A ~470 MB archive took 2h44m on 2026-11-25 (~47 KB/s to Google); allow
// 6 hours so a slower day still finishes before the 26-hour readiness window.
const ARCHIVE_TRANSFER_TIMEOUT_MS = 6 * 60 * 60_000;

function runRclone(
  config: GoogleDriveBackupConfig,
  args: string[],
  options: { timeoutMs?: number; captureOutput?: boolean; maxOutputBytes?: number } = {},
): Promise<string> {
  const captureOutput = options.captureOutput ?? false;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_RCLONE_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn(config.rcloneBin, [
      "--config", config.configPath,
      "--ask-password=false",
      ...rcloneBindArgs(),
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
      if (Buffer.byteLength(output) + chunk.byteLength > maxOutputBytes) {
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

export async function md5File(filePath: string) {
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

  const cacheKey = `${config.rcloneBin}\n${config.configPath}\n${remotePath}\n${expectedSize}\n${expectedMd5}`;
  const now = Date.now();
  const cached = archiveVerificationCache.get(cacheKey);
  if (cached) {
    // Concurrent callers share one in-flight lookup.
    const settled = await Promise.race([cached.result, Promise.resolve(undefined)]);
    const ttl = settled === false ? ARCHIVE_FAILED_CACHE_MS : ARCHIVE_VERIFIED_CACHE_MS;
    if (settled === undefined || now - cached.checkedAt < ttl) return cached.result;
  }

  const result = readRemoteFileInfo(config, remotePath)
    .then((info) => info.IsDir !== true
      && info.Size === expectedSize
      && md5Hash(info) === expectedMd5)
    .catch(() => false);
  archiveVerificationCache.clear();
  archiveVerificationCache.set(cacheKey, { checkedAt: now, result });
  return result;
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
  await runRclone(config, ["copyto", "--immutable", input.localPath, remotePath], { timeoutMs: ARCHIVE_TRANSFER_TIMEOUT_MS });
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

  await runRclone(config, ["copyto", remotePath, input.destinationPath], { timeoutMs: ARCHIVE_TRANSFER_TIMEOUT_MS });
  await chmod(input.destinationPath, 0o600);
}

/** Drive's MD5 of an uploaded archive, to check a download without the SHA-256 recorded on the old Mac. */
export async function readGoogleDriveBackupArchiveMd5(input: {
  archiveKey: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const { config, blockers } = getConfig(input.env);
  const remotePath = config ? getRemoteArchivePath(config.remoteRoot, input.archiveKey) : null;
  if (!config || !remotePath || blockers.length > 0) throw new Error("BACKUP_DESTINATION_NOT_READY");
  const md5 = md5Hash(await readRemoteFileInfo(config, remotePath));
  if (!md5 || !/^[0-9a-f]{32}$/.test(md5)) throw new Error("GOOGLE_DRIVE_ARCHIVE_HASH_UNAVAILABLE");
  return md5;
}

export type GoogleDriveBackupArchive = {
  archiveKey: string;
  sizeBytes: number;
  modifiedAt: string;
};

const REMOTE_ARCHIVE_PATH_PATTERN = /^[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/lumapos-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.lumaenc$/i;

/**
 * Archives in the Drive folder, newest first. A new Mac has no backup
 * history of its own, so setup lists what is on Drive.
 */
export async function listGoogleDriveBackupArchives(input: {
  limit?: number;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<GoogleDriveBackupArchive[]> {
  const { config, blockers } = getConfig(input.env);
  if (!config || blockers.length > 0) throw new Error("BACKUP_DESTINATION_NOT_READY");
  const output = await runRclone(config, [
    "lsjson", "--recursive", "--files-only", "--no-mimetype", config.remoteRoot,
  ], { timeoutMs: 120_000, captureOutput: true, maxOutputBytes: 8 * 1024 * 1024 });
  const entries = JSON.parse(output) as Array<{ Path?: string; Size?: number; ModTime?: string }>;
  return entries
    .filter((entry) => typeof entry.Path === "string" && REMOTE_ARCHIVE_PATH_PATTERN.test(entry.Path)
      && Number.isSafeInteger(entry.Size) && (entry.Size ?? 0) > 0)
    .map((entry) => ({
      archiveKey: `${GOOGLE_DRIVE_ARCHIVE_PREFIX}${entry.Path}`,
      sizeBytes: entry.Size as number,
      modifiedAt: new Date(entry.ModTime ?? 0).toISOString(),
    }))
    .sort((first, second) => second.modifiedAt.localeCompare(first.modifiedAt))
    .slice(0, Math.max(1, Math.min(input.limit ?? 30, 200)));
}

export function isGoogleDriveArchiveKey(value: unknown): boolean {
  return typeof value === "string" && ARCHIVE_KEY_PATTERN.test(value);
}
