import { constants as fsConstants } from "node:fs";
import { access, lstat, stat } from "node:fs/promises";
import path from "node:path";

export type BackupVolumeReadiness = {
  configured: boolean;
  deviceId: number | null;
  blockers: string[];
};

export async function readBackupVolumeReadiness(input: {
  backupRoot: string | undefined;
  mediaRoot: string | null | undefined;
  applicationRoot: string;
}): Promise<BackupVolumeReadiness> {
  const backupRoot = input.backupRoot?.trim() ?? "";
  if (!backupRoot || !path.isAbsolute(backupRoot)) {
    return { configured: false, deviceId: null, blockers: ["volumeConfiguration"] };
  }

  let backupStats;
  try {
    backupStats = await stat(backupRoot);
  } catch {
    return { configured: false, deviceId: null, blockers: ["volumeUnavailable"] };
  }
  if (!backupStats.isDirectory()) {
    return { configured: false, deviceId: null, blockers: ["volumeUnavailable"] };
  }

  const blockers: string[] = [];
  try {
    await access(backupRoot, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  } catch {
    blockers.push("volumeNotWritable");
  }

  try {
    const applicationStats = await stat(input.applicationRoot);
    if (backupStats.dev === applicationStats.dev) {
      blockers.push("volumeSharesApplicationDisk");
    }
  } catch {
    blockers.push("applicationVolumeUnknown");
  }

  if (!input.mediaRoot) {
    blockers.push("mediaVolumeUnknown");
  } else {
    try {
      const mediaStats = await stat(input.mediaRoot);
      if (backupStats.dev === mediaStats.dev) {
        blockers.push("volumeSharesMediaDisk");
      }
    } catch {
      blockers.push("mediaVolumeUnknown");
    }
  }

  return { configured: blockers.length === 0, deviceId: backupStats.dev, blockers };
}

export async function isExternalBackupArchivePresent(input: {
  backupRoot: string | undefined;
  archiveKey: unknown;
  archiveSizeBytes: unknown;
  archiveSha256: unknown;
}): Promise<boolean> {
  const backupRoot = input.backupRoot?.trim() ?? "";
  const archiveKey = typeof input.archiveKey === "string" ? input.archiveKey : "";
  if (
    !backupRoot
    || !path.isAbsolute(backupRoot)
    || !/^external-disk\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/lumapos-[0-9a-f-]{36}\.lumaenc$/i.test(archiveKey)
    || typeof input.archiveSha256 !== "string"
    || !/^[0-9a-f]{64}$/i.test(input.archiveSha256)
  ) {
    return false;
  }

  let expectedSize: number;
  try {
    expectedSize = Number(input.archiveSizeBytes);
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) return false;
    const rootStats = await stat(backupRoot);
    if (!rootStats.isDirectory()) return false;
    const archiveStats = await lstat(path.join(backupRoot, ...archiveKey.split("/")));
    return archiveStats.isFile()
      && !archiveStats.isSymbolicLink()
      && archiveStats.dev === rootStats.dev
      && archiveStats.size === expectedSize;
  } catch {
    return false;
  }
}
