import { createDecipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, open, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { loadEnvConfig } from "@next/env";
import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "@/db/migration-runner";
import { postgresUtilityMajorVersion, resolvePostgresUtility } from "./postgres-tools";

const MAGIC = Buffer.from("LUMABKP1");
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

loadEnvConfig(process.cwd());

if (!process.argv.includes("--confirm-empty-database")) {
  throw new Error("Restore requires --confirm-empty-database and a stopped LumaPOS application");
}
const archiveName = argument("archive");
if (!archiveName || path.basename(archiveName) !== archiveName || !/^lumapos-[0-9a-f-]{36}\.lumaenc$/i.test(archiveName)) {
  throw new Error("Pass --archive <lumapos-backup-id.lumaenc>");
}
const backupRoot = process.env.LUMAPOS_BACKUP_ROOT?.trim();
const mediaRoot = process.env.MEDIA_LOCAL_ROOT?.trim();
if (!backupRoot || !path.isAbsolute(backupRoot)) throw new Error("LUMAPOS_BACKUP_ROOT must be an absolute path");
if (!mediaRoot || !path.isAbsolute(mediaRoot)) throw new Error("MEDIA_LOCAL_ROOT must be an absolute path");
const migrationDatabase = readMigrationDatabaseUrl(process.env);
const databaseUrl = migrationDatabase.connectionString;
const parsedUrl = new URL(databaseUrl);
if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
  throw new Error("MIGRATION_DATABASE_URL must use the postgres or postgresql protocol");
}
if (parsedUrl.hostname.endsWith(".supabase.com") || parsedUrl.hostname.endsWith(".supabase.co")) {
  throw new Error("Restore cannot target a Supabase database endpoint");
}

const encodedKey = process.env.LUMAPOS_BACKUP_ENCRYPTION_KEY?.trim() ?? "";
if (!/^[0-9a-f]{64}$/i.test(encodedKey)) {
  throw new Error("LUMAPOS_BACKUP_ENCRYPTION_KEY must be a 32-byte hexadecimal key");
}
const encryptionKey = Buffer.from(encodedKey, "hex");
const resolvedBackupRoot = path.resolve(backupRoot);
const resolvedMediaRoot = path.resolve(mediaRoot);
const resolvedProjectRoot = path.resolve(process.cwd());
function isPathInside(parent: string, candidate: string) {
  return candidate.startsWith(`${parent}${path.sep}`);
}
if (
  resolvedBackupRoot === resolvedMediaRoot
  || isPathInside(resolvedBackupRoot, resolvedMediaRoot)
  || isPathInside(resolvedMediaRoot, resolvedBackupRoot)
) {
  throw new Error("Backup and media directories must be separate sibling trees");
}
if (
  resolvedBackupRoot === resolvedProjectRoot
  || isPathInside(resolvedProjectRoot, resolvedBackupRoot)
  || isPathInside(resolvedBackupRoot, resolvedProjectRoot)
  || resolvedMediaRoot === resolvedProjectRoot
  || isPathInside(resolvedProjectRoot, resolvedMediaRoot)
  || isPathInside(resolvedMediaRoot, resolvedProjectRoot)
) {
  throw new Error("Backup and media directories must be outside the application directory");
}
const archivePath = path.join(resolvedBackupRoot, archiveName);

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", () => reject(new Error("RESTORE_COMMAND_UNAVAILABLE")));
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error("RESTORE_COMMAND_FAILED")));
  });
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const archiveStats = await lstat(archivePath);
if (!archiveStats.isFile() || archiveStats.isSymbolicLink() || archiveStats.size < MAGIC.byteLength + 12 + 16) {
  throw new Error("Backup archive is missing or incomplete");
}
const expectedSha256 = argument("sha256")?.toLowerCase();
const archiveSha256 = await sha256File(archivePath);
if (expectedSha256 && archiveSha256 !== expectedSha256) {
  throw new Error("Backup archive checksum does not match the supplied checksum");
}

const connection = createMigrationPostgresClient(migrationDatabase);
const staging = await mkdtemp(path.join(os.tmpdir(), "lumapos-restore-"));
const bundlePath = path.join(staging, "backup.tar.gz");
const unpackPath = path.join(staging, "unpacked");
await mkdir(unpackPath, { mode: 0o700 });

try {
  const [{ relationCount }] = await connection.unsafe(`
    SELECT count(*)::int AS "relationCount"
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  `) as Array<{ relationCount: number }>;
  if (relationCount !== 0) {
    throw new Error("Restore stopped because the target database is not empty");
  }

  const mediaEntries = await readdir(resolvedMediaRoot).catch((error: unknown) => {
    if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  if (mediaEntries.length > 0) throw new Error("Restore stopped because the media directory is not empty");

  const currentVersion = Number((await connection.unsafe("show server_version_num") as Array<{ server_version_num: string }>)[0].server_version_num);
  const pgRestorePath = resolvePostgresUtility("pg_restore");
  if (postgresUtilityMajorVersion(pgRestorePath) !== Math.floor(currentVersion / 10_000)) {
    throw new Error("PG_RESTORE_VERSION_MISMATCH");
  }
  const handle = await open(archivePath, "r");
  const header = Buffer.alloc(MAGIC.byteLength + 12);
  const tag = Buffer.alloc(16);
  try {
    const headerRead = await handle.read(header, 0, header.length, 0);
    const tagRead = await handle.read(tag, 0, tag.length, archiveStats.size - tag.length);
    if (headerRead.bytesRead !== header.length || tagRead.bytesRead !== tag.length
      || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Backup archive format is not supported");
    }
    const nonce = header.subarray(MAGIC.length);
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey, nonce);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(archivePath, {
        start: header.length,
        end: archiveStats.size - tag.length - 1,
      }),
      decipher,
      createWriteStream(bundlePath, { flags: "wx", mode: 0o600 }),
    );
  } finally {
    await handle.close();
  }

  await run("tar", ["-xzf", bundlePath, "-C", unpackPath, "--no-same-owner", "--no-same-permissions"]);
  const manifest = JSON.parse(await readFile(
    path.join(unpackPath, "manifest.json"),
    "utf8",
  )) as {
    format?: string;
    version?: number;
    databaseMajorVersion?: number;
    files?: Array<{ name: string; sizeBytes: number; sha256: string }>;
  };
  if (manifest.format !== "postgres-custom-and-media-aes-256-gcm"
    || manifest.version !== 1
    || manifest.databaseMajorVersion !== Math.floor(currentVersion / 10_000)
    || !Array.isArray(manifest.files)
    || manifest.files.length !== 2) {
    throw new Error("Backup manifest is incompatible with the target PostgreSQL version");
  }
  const verifiedFiles = new Set<string>();
  for (const expected of manifest.files) {
    if (
      !/^(database\.dump|media\.tar\.gz)$/.test(expected.name)
      || verifiedFiles.has(expected.name)
      || !Number.isSafeInteger(expected.sizeBytes)
      || expected.sizeBytes < 0
      || !/^[0-9a-f]{64}$/i.test(expected.sha256)
    ) {
      throw new Error("Backup manifest contains an unexpected file");
    }
    verifiedFiles.add(expected.name);
    const filePath = path.join(unpackPath, expected.name);
    const [fileStats, actualSha256] = await Promise.all([stat(filePath), sha256File(filePath)]);
    if (fileStats.size !== expected.sizeBytes || actualSha256 !== expected.sha256) {
      throw new Error("Backup file checksum verification failed");
    }
  }
  if (!verifiedFiles.has("database.dump") || !verifiedFiles.has("media.tar.gz")) {
    throw new Error("Backup archive must include both the database and media files");
  }
  const mediaArchiveBytes = (await stat(path.join(unpackPath, "media.tar.gz"))).size;

  const password = decodeURIComponent(parsedUrl.password);
  const restoreEnvironment = {
    ...process.env,
    PGPASSWORD: password,
    PGSSLMODE: parsedUrl.searchParams.get("sslmode") ?? "disable",
  };
  await run(pgRestorePath, [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    "--host", parsedUrl.hostname,
    "--port", parsedUrl.port || "5432",
    "--username", decodeURIComponent(parsedUrl.username),
    "--dbname", decodeURIComponent(parsedUrl.pathname.slice(1)),
    path.join(unpackPath, "database.dump"),
  ], restoreEnvironment);

  await mkdir(resolvedMediaRoot, { recursive: true, mode: 0o700 });
  await run("tar", [
    "-xzf", path.join(unpackPath, "media.tar.gz"),
    "-C", resolvedMediaRoot,
    "--no-same-owner",
    "--no-same-permissions",
  ]);

  // The encrypted archive intentionally excludes ACLs. Restore the restricted
  // application grants after pg_restore, using the same DBA role that owns the
  // restored objects and will apply future migrations.
  const runtimePrivileges = [
    `DO $$
     DECLARE runtime_role pg_roles%ROWTYPE;
     BEGIN
       SELECT * INTO runtime_role FROM pg_roles WHERE rolname = 'lumapos_runtime';
       IF NOT FOUND
         OR NOT runtime_role.rolcanlogin
         OR runtime_role.rolsuper
         OR runtime_role.rolcreatedb
         OR runtime_role.rolcreaterole
         OR NOT runtime_role.rolbypassrls
         OR runtime_role.rolreplication THEN
         RAISE EXCEPTION 'lumapos_runtime is missing or has unsafe role attributes';
       END IF;
     END
     $$`,
    `DO $$ BEGIN
       EXECUTE format('GRANT CONNECT ON DATABASE %I TO lumapos_runtime', current_database());
     END $$`,
    "GRANT USAGE ON SCHEMA public TO lumapos_runtime",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lumapos_runtime",
    "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO lumapos_runtime",
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lumapos_runtime",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lumapos_runtime",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lumapos_runtime",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO lumapos_runtime",
  ];
  for (const statement of runtimePrivileges) await connection.unsafe(statement);

  console.log(JSON.stringify({
    status: "restored",
    databaseMajorVersion: manifest.databaseMajorVersion,
    mediaArchiveBytes,
    archiveSha256,
  }));
} finally {
  await connection.end({ timeout: 5 });
  await rm(staging, { recursive: true, force: true });
}
