import { randomBytes, createCipheriv, createHash } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import { access, appendFile, mkdtemp, readdir, rename, rm, stat, writeFile, lstat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { hostname } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { loadEnvConfig } from "@next/env";
import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "@/db/migration-runner";
import { assertSelfHostedDatabaseEndpoint } from "@/db/self-hosted-primary";
import {
  readGoogleDriveBackupReadiness,
  uploadGoogleDriveBackupArchive,
} from "@/lib/ops/google-drive-backups";
import { postgresUtilityMajorVersion, resolvePostgresUtility } from "./postgres-tools";

const WORKER_LOCK_KEY = 1_280_657_220;
const POLL_INTERVAL_MS = 10_000;
const MAGIC = Buffer.from("LUMABKP1");
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const once = process.argv.slice(2).includes("--once");
const scheduled = process.argv.slice(2).includes("--scheduled");

loadEnvConfig(process.cwd());
const pgDumpPath = resolvePostgresUtility("pg_dump");

if (process.env.LUMAPOS_AUTH_PROVIDER !== "lumapos") {
  throw new Error("The database backup worker requires LUMAPOS_AUTH_PROVIDER=lumapos");
}
if (process.env.LUMAPOS_BACKUP_SOURCE_CONFIRMED !== "true") {
  throw new Error("Backups are disabled until the operator confirms the selected self-hosted snapshot source");
}
assertSelfHostedDatabaseEndpoint(process.env);
if (process.env.MEDIA_WRITE_PROVIDER !== "local") {
  throw new Error("The self-hosted backup worker requires MEDIA_WRITE_PROVIDER=local");
}
if (process.env.LUMAPOS_BACKUP_PROVIDER !== "google-drive") {
  throw new Error("The self-hosted backup worker requires LUMAPOS_BACKUP_PROVIDER=google-drive");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
const parsedUrl = new URL(databaseUrl);
if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
}
const sessionUrl = new URL(databaseUrl);
if (sessionUrl.hostname.endsWith(".pooler.supabase.com") && sessionUrl.port === "6543") {
  sessionUrl.port = "5432";
}
const stagingRoot = process.env.LUMAPOS_BACKUP_STAGING_ROOT?.trim();
const mediaRoot = process.env.MEDIA_LOCAL_ROOT?.trim();
if (!stagingRoot || !path.isAbsolute(stagingRoot)) {
  throw new Error("LUMAPOS_BACKUP_STAGING_ROOT must be an absolute path");
}
if (!mediaRoot || !path.isAbsolute(mediaRoot)) {
  throw new Error("MEDIA_LOCAL_ROOT must be an absolute path");
}
const resolvedStagingRoot = path.resolve(stagingRoot);
const resolvedMediaRoot = path.resolve(mediaRoot);
const resolvedProjectRoot = path.resolve(process.cwd());
function isPathInside(parent: string, candidate: string) {
  return candidate.startsWith(`${parent}${path.sep}`);
}
if (
  resolvedStagingRoot === resolvedMediaRoot
  || isPathInside(resolvedStagingRoot, resolvedMediaRoot)
  || isPathInside(resolvedMediaRoot, resolvedStagingRoot)
) {
  throw new Error("Backup staging and media directories must be separate trees");
}
if (
  resolvedMediaRoot === resolvedProjectRoot
  || isPathInside(resolvedProjectRoot, resolvedMediaRoot)
  || isPathInside(resolvedMediaRoot, resolvedProjectRoot)
) {
  throw new Error("Media directory must be outside the application directory");
}
if (
  resolvedStagingRoot === resolvedProjectRoot
  || isPathInside(resolvedProjectRoot, resolvedStagingRoot)
  || isPathInside(resolvedStagingRoot, resolvedProjectRoot)
) {
  throw new Error("Backup staging directory must be outside the application directory");
}
const encodedKey = process.env.LUMAPOS_BACKUP_ENCRYPTION_KEY?.trim() ?? "";
if (!/^[0-9a-f]{64}$/i.test(encodedKey)) {
  throw new Error("LUMAPOS_BACKUP_ENCRYPTION_KEY must be a 32-byte hexadecimal key");
}
const encryptionKey = Buffer.from(encodedKey, "hex");

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", () => reject(new Error("BACKUP_COMMAND_UNAVAILABLE")));
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error("BACKUP_COMMAND_FAILED")));
  });
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function cleanInterruptedBackupStages() {
  const entries = await readdir(resolvedStagingRoot);
  for (const entry of entries) {
    if (!entry.startsWith(".lumapos-backup-")) continue;
    const candidate = path.join(resolvedStagingRoot, entry);
    const candidateStats = await lstat(candidate).catch(() => null);
    if (candidateStats?.isDirectory() && !candidateStats.isSymbolicLink()) {
      await rm(candidate, { recursive: true, force: true });
    }
  }
}

async function encryptFile(inputPath: string, outputPath: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey, nonce);
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  output.write(MAGIC);
  output.write(nonce);
  await pipeline(createReadStream(inputPath), cipher, output);
  await appendFile(outputPath, cipher.getAuthTag(), { mode: 0o600 });
}

const connection = createMigrationPostgresClient(readMigrationDatabaseUrl({
  MIGRATION_DATABASE_URL: sessionUrl.toString(),
}));
const [{ locked }] = await connection.unsafe(
  "select pg_try_advisory_lock($1) as locked",
  [WORKER_LOCK_KEY],
) as Array<{ locked: boolean }>;
if (!locked) {
  console.log("Another LumaPOS database backup worker already holds the worker lock.");
  await connection.end({ timeout: 5 });
  process.exit(0);
}

const workerId = `${hostname()}:${process.pid}`;
let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

async function writeHeartbeat(state: "running" | "stopped") {
  await connection.unsafe(`
    INSERT INTO public.system_worker_heartbeats
      (worker_key, worker_id, state, started_at, last_seen_at, details)
    VALUES ('database-backup', $1, $2, now(), now(), '{}'::jsonb)
    ON CONFLICT (worker_key) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      state = EXCLUDED.state,
      started_at = EXCLUDED.started_at,
      last_seen_at = now(),
      details = EXCLUDED.details
  `, [workerId, state]);
}

async function requestScheduledBackup() {
  const scheduleKey = `daily-${new Date().toISOString().slice(0, 10)}`;
  const [existingSchedule] = await connection.unsafe(`
    SELECT id::text, status FROM public.database_backup_runs WHERE schedule_key = $1 LIMIT 1
  `, [scheduleKey]) as Array<{ id: string; status: string }>;
  if (existingSchedule) {
    if (existingSchedule.status === "failed") {
      await connection.unsafe(`
        UPDATE public.database_backup_runs failed_run
        SET status = 'queued', requested_at = now(), started_at = NULL,
            finished_at = NULL, duration_milliseconds = NULL, failure_code = NULL,
            archive_key = NULL, archive_size_bytes = NULL, sha256 = NULL, manifest = '{}'::jsonb
        WHERE failed_run.id = $1::uuid
          AND ($2::boolean OR failed_run.finished_at < now() - interval '15 minutes')
          AND NOT EXISTS (
            SELECT 1 FROM public.database_backup_runs active_run
            WHERE active_run.status IN ('queued', 'running')
          )
      `, [existingSchedule.id, once]);
    }
    return;
  }
  const [activeRun] = await connection.unsafe(`
    SELECT id::text FROM public.database_backup_runs
    WHERE status IN ('queued', 'running')
    ORDER BY requested_at, id LIMIT 1
  `) as Array<{ id: string }>;
  if (activeRun) {
    await connection.unsafe(`
      UPDATE public.database_backup_runs
      SET schedule_key = COALESCE(schedule_key, $1)
      WHERE id = $2::uuid AND status IN ('queued', 'running')
    `, [scheduleKey, activeRun.id]);
    return;
  }
  await connection.unsafe(`
    INSERT INTO public.database_backup_runs (trigger_type, status, schedule_key)
    VALUES ('scheduled', 'queued', $1)
    ON CONFLICT DO NOTHING
  `, [scheduleKey]);
}

async function claimRun() {
  const [row] = await connection.unsafe(`
    WITH candidate AS (
      SELECT id FROM public.database_backup_runs
      WHERE status = 'queued'
      ORDER BY requested_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE public.database_backup_runs backup
    SET status = 'running', started_at = now(), finished_at = NULL,
        failure_code = NULL, archive_key = NULL, archive_size_bytes = NULL,
        sha256 = NULL, manifest = '{}'::jsonb
    FROM candidate
    WHERE backup.id = candidate.id
    RETURNING backup.id::text
  `) as Array<{ id: string }>;
  return row?.id ?? null;
}

async function createBackup(runId: string) {
  const destinationReadiness = await readGoogleDriveBackupReadiness({
    applicationRoot: resolvedProjectRoot,
    mediaRoot: resolvedMediaRoot,
  });
  if (!destinationReadiness.configured) {
    throw new Error(`BACKUP_DESTINATION_NOT_READY:${destinationReadiness.blockers.join(",")}`);
  }

  const [{ mediaCount }] = await connection.unsafe(`
    SELECT count(*)::int AS "mediaCount"
    FROM public.media_objects
    WHERE status = 'ready' AND provider <> 'local'
  `) as Array<{ mediaCount: number }>;
  if (mediaCount > 0) throw new Error("BACKUP_HAS_NON_LOCAL_MEDIA");

  const serverVersion = Number((await connection.unsafe("show server_version_num") as Array<{ server_version_num: string }>)[0].server_version_num);
  const databaseMajorVersion = Math.floor(serverVersion / 10_000);
  if (postgresUtilityMajorVersion(pgDumpPath) !== databaseMajorVersion) {
    throw new Error("PG_DUMP_VERSION_MISMATCH");
  }

  const dateParts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const datePart = (type: Intl.DateTimeFormatPartTypes) =>
    dateParts.find((part) => part.type === type)?.value ?? "00";
  const finalName = `lumapos-${runId}.lumaenc`;
  const archiveKey = `google-drive/${datePart("year")}/${datePart("month")}/${datePart("day")}/${finalName}`;

  const mediaRootStats = await stat(resolvedMediaRoot);
  if (!mediaRootStats.isDirectory()) throw new Error("MEDIA_ROOT_NOT_READY");
  await access(resolvedMediaRoot, fsConstants.R_OK | fsConstants.X_OK);
  const temporaryDirectory = await mkdtemp(path.join(resolvedStagingRoot, ".lumapos-backup-"));
  const dumpPath = path.join(temporaryDirectory, "database.dump");
  const mediaArchivePath = path.join(temporaryDirectory, "media.tar.gz");
  const bundlePath = path.join(temporaryDirectory, "backup.tar.gz");
  const partialPath = path.join(temporaryDirectory, `${finalName}.partial`);

  try {
    const password = decodeURIComponent(parsedUrl.password);
    const sourceEnvironment = {
      ...process.env,
      PGPASSWORD: password,
      PGSSLMODE: parsedUrl.searchParams.get("sslmode") ?? "disable",
    };
    await run(pgDumpPath, [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--schema=public",
      "--exclude-table-data=public.database_backup_runs",
      "--host", parsedUrl.hostname,
      "--port", parsedUrl.port || "5432",
      "--username", decodeURIComponent(parsedUrl.username),
      "--dbname", decodeURIComponent(parsedUrl.pathname.slice(1)),
      "--file", dumpPath,
    ], sourceEnvironment);
    await run("tar", ["-czf", mediaArchivePath, "-C", resolvedMediaRoot, "."]);

    const [dumpStats, mediaStats] = await Promise.all([stat(dumpPath), stat(mediaArchivePath)]);
    const files = [
      { name: "database.dump", sizeBytes: dumpStats.size, sha256: await sha256File(dumpPath) },
      { name: "media.tar.gz", sizeBytes: mediaStats.size, sha256: await sha256File(mediaArchivePath) },
    ];
    const manifest = {
      format: "postgres-custom-and-media-aes-256-gcm",
      version: 1,
      createdAt: new Date().toISOString(),
      databaseMajorVersion,
      included: ["public PostgreSQL schema and data", "local media files"],
      excluded: ["database_backup_runs history", "secrets stored outside PostgreSQL", "Supabase-managed schemas"],
      files,
    };
    const manifestPath = path.join(temporaryDirectory, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify(manifest),
      { mode: 0o600, flag: "wx" },
    );
    await run("tar", ["-czf", bundlePath, "-C", temporaryDirectory, "database.dump", "media.tar.gz", "manifest.json"]);
    await encryptFile(bundlePath, partialPath);
    const archivePath = path.join(temporaryDirectory, finalName);
    await rename(partialPath, archivePath);
    const archiveStats = await stat(archivePath);
    const archiveSha256 = await sha256File(archivePath);
    const uploadedArchive = await uploadGoogleDriveBackupArchive({ localPath: archivePath, archiveKey });
    if (uploadedArchive.sizeBytes !== archiveStats.size) {
      throw new Error("GOOGLE_DRIVE_ARCHIVE_VERIFY_FAILED");
    }
    const storedManifest = {
      ...manifest,
      destination: {
        provider: "google-drive",
        relativePath: archiveKey,
        archiveSha256,
        archiveMd5: uploadedArchive.md5,
      },
    };

    await connection.unsafe(`
      UPDATE public.database_backup_runs
      SET status = 'succeeded', finished_at = now(),
          duration_milliseconds = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::int),
          archive_key = $1, archive_size_bytes = $2, sha256 = $3,
          manifest = $4::jsonb, failure_code = NULL
      WHERE id = $5::uuid AND status = 'running'
    `, [archiveKey, uploadedArchive.sizeBytes, archiveSha256, JSON.stringify(storedManifest), runId]);

    console.log(JSON.stringify({
      backupRunId: runId,
      status: "succeeded",
      archiveKey,
      archiveSizeBytes: uploadedArchive.sizeBytes,
      sha256: archiveSha256,
    }));
  } catch (error) {
    await connection.unsafe(`
      UPDATE public.database_backup_runs
      SET status = 'failed', finished_at = now(),
          duration_milliseconds = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::int),
          failure_code = $1
      WHERE id = $2::uuid AND status = 'running'
    `, [error instanceof Error && error.message === "BACKUP_HAS_NON_LOCAL_MEDIA"
      ? "MEDIA_NOT_LOCAL"
      : error instanceof Error && error.message.startsWith("BACKUP_DESTINATION_NOT_READY")
        ? "BACKUP_DESTINATION_NOT_READY"
        : error instanceof Error && error.message === "GOOGLE_DRIVE_ARCHIVE_VERIFY_FAILED"
          ? "BACKUP_REMOTE_VERIFY_FAILED"
          : "BACKUP_FAILED", runId]);
    console.error("Database backup failed; see backup status in LumaPOS administration.");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function recoverStaleRuns() {
  await connection.unsafe(`
    UPDATE public.database_backup_runs
    SET status = 'queued', started_at = NULL, failure_code = 'WORKER_RESTARTED'
    WHERE status = 'running' AND started_at < now() - interval '2 hours'
  `);
}

try {
  await cleanInterruptedBackupStages();
  await writeHeartbeat("running");
  await recoverStaleRuns();
  do {
    if (scheduled) await requestScheduledBackup();
    const runId = await claimRun();
    if (runId) await createBackup(runId);
    await writeHeartbeat("running");
    if (once) break;
    if (!runId) await delay(POLL_INTERVAL_MS);
  } while (running);
} finally {
  await writeHeartbeat("stopped").catch(() => undefined);
  await connection.unsafe("select pg_advisory_unlock($1)", [WORKER_LOCK_KEY]).catch(() => undefined);
  await connection.end({ timeout: 5 });
}
