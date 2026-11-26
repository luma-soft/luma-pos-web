/**
 * The encrypted LumaPOS archive (LUMABKP1): a pg_dump of the public schema
 * and a tarball of local media, bundled with a manifest and encrypted with
 * AES-256-GCM. Written by the scheduled Drive backups and by the export for
 * moving to another Mac; read by restore-database-backup.ts.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("LUMABKP1");
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

export type BackupArchiveManifest = {
  format: "postgres-custom-and-media-aes-256-gcm";
  version: 1;
  createdAt: string;
  databaseMajorVersion: number;
  included: string[];
  excluded: string[];
  files: Array<{ name: string; sizeBytes: number; sha256: string }>;
};

/**
 * Settings that belong to one machine or one database cluster; the rest of
 * runtime.env (keys that encrypt or sign stored data, feature flags) travels
 * with the archive so a restore on another Mac keeps working.
 */
export const MACHINE_SPECIFIC_SETTINGS = new Set([
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "LUMAPOS_RCLONE_BIN",
  "LUMAPOS_POSTGRES_BIN_DIR",
  "LUMAPOS_BUN_BIN",
  "LUMAPOS_LISTEN_ADDRESS",
  "LUMAPOS_LAN_HTTP",
]);

/** runtime.env without machine-specific keys; the last value of a key wins. */
export function portableSettings(envText: string): string {
  const values = new Map<string, string>();
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(export\s+)?/, "");
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || MACHINE_SPECIFIC_SETTINGS.has(match[1])) continue;
    values.delete(match[1]);
    values.set(match[1], match[2]);
  }
  return [...values].map(([key, value]) => `${key}=${value}\n`).join("");
}

export function runQuietly(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", () => reject(new Error("BACKUP_COMMAND_UNAVAILABLE")));
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error("BACKUP_COMMAND_FAILED")));
  });
}

export async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function encryptFile(inputPath: string, outputPath: string, encryptionKey: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey, nonce);
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  output.write(MAGIC);
  output.write(nonce);
  await pipeline(createReadStream(inputPath), cipher, output);
  await appendFile(outputPath, cipher.getAuthTag(), { mode: 0o600 });
}

/**
 * Builds `<workDirectory>/<finalName>`. The caller owns the private work
 * directory and removes it afterwards.
 */
export async function buildEncryptedArchive(input: {
  workDirectory: string;
  finalName: string;
  databaseUrl: URL;
  mediaRoot: string;
  pgDumpPath: string;
  databaseMajorVersion: number;
  encryptionKey: Buffer;
  /** runtime.env of this Mac; its portable settings go into the archive. */
  settingsPath?: string;
}): Promise<{ archivePath: string; manifest: BackupArchiveManifest; sizeBytes: number; sha256: string }> {
  const { workDirectory, databaseUrl } = input;
  const dumpPath = path.join(workDirectory, "database.dump");
  const mediaArchivePath = path.join(workDirectory, "media.tar.gz");
  const bundlePath = path.join(workDirectory, "backup.tar.gz");
  const partialPath = path.join(workDirectory, `${input.finalName}.partial`);

  const sourceEnvironment = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGSSLMODE: databaseUrl.searchParams.get("sslmode") ?? "disable",
  };
  // The backup history is included: a restored store keeps knowing its last
  // Drive backup (readiness), and the restore marks the runs that were still
  // queued or running on the old Mac as failed.
  await runQuietly(input.pgDumpPath, [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--schema=public",
    "--host", databaseUrl.hostname,
    "--port", databaseUrl.port || "5432",
    "--username", decodeURIComponent(databaseUrl.username),
    "--dbname", decodeURIComponent(databaseUrl.pathname.slice(1)),
    "--file", dumpPath,
  ], sourceEnvironment);
  await runQuietly("tar", ["-czf", mediaArchivePath, "-C", input.mediaRoot, "."]);

  const settingsFile = path.join(workDirectory, "settings.env");
  const includeSettings = Boolean(input.settingsPath);
  if (input.settingsPath) {
    await writeFile(settingsFile, portableSettings(await readFile(input.settingsPath, "utf8")), { mode: 0o600, flag: "wx" });
  }
  const [dumpStats, mediaStats] = await Promise.all([stat(dumpPath), stat(mediaArchivePath)]);
  const manifest: BackupArchiveManifest = {
    format: "postgres-custom-and-media-aes-256-gcm",
    version: 1,
    createdAt: new Date().toISOString(),
    databaseMajorVersion: input.databaseMajorVersion,
    included: [
      "public PostgreSQL schema and data",
      "local media files",
      ...(includeSettings ? ["runtime settings and keys (settings.env)"] : []),
    ],
    excluded: [
      includeSettings ? "database URLs and machine paths" : "secrets stored outside PostgreSQL",
      "Supabase-managed schemas",
    ],
    files: [
      { name: "database.dump", sizeBytes: dumpStats.size, sha256: await sha256File(dumpPath) },
      { name: "media.tar.gz", sizeBytes: mediaStats.size, sha256: await sha256File(mediaArchivePath) },
      ...(includeSettings
        ? [{ name: "settings.env", sizeBytes: (await stat(settingsFile)).size, sha256: await sha256File(settingsFile) }]
        : []),
    ],
  };
  await writeFile(path.join(workDirectory, "manifest.json"), JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
  await runQuietly("tar", [
    "-czf", bundlePath, "-C", workDirectory,
    "database.dump", "media.tar.gz", ...(includeSettings ? ["settings.env"] : []), "manifest.json",
  ]);
  await encryptFile(bundlePath, partialPath, input.encryptionKey);
  const archivePath = path.join(workDirectory, input.finalName);
  await rename(partialPath, archivePath);
  const archiveStats = await stat(archivePath);
  return { archivePath, manifest, sizeBytes: archiveStats.size, sha256: await sha256File(archivePath) };
}
