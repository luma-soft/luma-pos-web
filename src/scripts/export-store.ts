/**
 * Operations-only: writes an encrypted archive of the store (database and
 * media, same format as the Drive backups) into LUMAPOS_BACKUP_STAGING_ROOT
 * for moving to another Mac. Run by `lumapos-admin export-for-move` after the
 * services that write have been stopped. Prints one JSON line.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createMigrationPostgresClient, readMigrationDatabaseUrl } from "@/db/migration-runner";
import { postgresUtilityMajorVersion, resolvePostgresUtility } from "./postgres-tools";
import { buildEncryptedArchive } from "./backup-archive";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
const parsedUrl = new URL(databaseUrl);
if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
}
const stagingRoot = process.env.LUMAPOS_BACKUP_STAGING_ROOT?.trim();
const mediaRoot = process.env.MEDIA_LOCAL_ROOT?.trim();
if (!stagingRoot || !path.isAbsolute(stagingRoot)) throw new Error("LUMAPOS_BACKUP_STAGING_ROOT must be an absolute path");
if (!mediaRoot || !path.isAbsolute(mediaRoot)) throw new Error("MEDIA_LOCAL_ROOT must be an absolute path");
const encodedKey = process.env.LUMAPOS_BACKUP_ENCRYPTION_KEY?.trim() ?? "";
if (!/^[0-9a-f]{64}$/i.test(encodedKey)) throw new Error("LUMAPOS_BACKUP_ENCRYPTION_KEY must be a 32-byte hexadecimal key");

const resolvedStagingRoot = path.resolve(stagingRoot);
const resolvedMediaRoot = path.resolve(mediaRoot);
if (!(await stat(resolvedMediaRoot)).isDirectory()) throw new Error("MEDIA_ROOT_NOT_READY");

const connection = createMigrationPostgresClient(readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: databaseUrl }));
const workDirectory = await mkdtemp(path.join(resolvedStagingRoot, ".lumapos-export-"));
try {
  const [{ mediaCount }] = await connection.unsafe(`
    SELECT count(*)::int AS "mediaCount"
    FROM public.media_objects
    WHERE status = 'ready' AND provider <> 'local'
  `) as Array<{ mediaCount: number }>;
  if (mediaCount > 0) throw new Error("EXPORT_HAS_NON_LOCAL_MEDIA");

  const serverVersion = Number((await connection.unsafe("show server_version_num") as Array<{ server_version_num: string }>)[0].server_version_num);
  const databaseMajorVersion = Math.floor(serverVersion / 10_000);
  const pgDumpPath = resolvePostgresUtility("pg_dump");
  if (postgresUtilityMajorVersion(pgDumpPath) !== databaseMajorVersion) throw new Error("PG_DUMP_VERSION_MISMATCH");

  // restore-database-backup.ts accepts lumapos-<uuid>-<epoch ms>.lumaenc
  // directly under the staging root.
  const finalName = `lumapos-${randomUUID()}-${Date.now()}.lumaenc`;
  const archive = await buildEncryptedArchive({
    workDirectory,
    finalName,
    databaseUrl: parsedUrl,
    mediaRoot: resolvedMediaRoot,
    pgDumpPath,
    databaseMajorVersion,
    settingsPath: process.env.LUMAPOS_ENV_FILE?.trim() || undefined,
    encryptionKey: Buffer.from(encodedKey, "hex"),
  });
  await rename(archive.archivePath, path.join(resolvedStagingRoot, finalName));
  console.log(JSON.stringify({
    status: "exported",
    archiveName: finalName,
    sizeBytes: archive.sizeBytes,
    sha256: archive.sha256,
    createdAt: archive.manifest.createdAt,
  }));
} finally {
  await connection.end({ timeout: 5 });
  await rm(workDirectory, { recursive: true, force: true });
}
