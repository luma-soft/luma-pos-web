import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "./migration-runner";

const configuredMigrationUrl = process.env.MIGRATION_DATABASE_URL?.trim();
const configuredUrl = process.env.DATABASE_URL?.trim();
if (!configuredMigrationUrl && !configuredUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL must be set");
}
if (configuredMigrationUrl && configuredUrl
  && process.env.LUMAPOS_AUTH_PROVIDER?.trim().toLowerCase() === "lumapos") {
  let runtimeUsername: string;
  let migrationUsername: string;
  try {
    runtimeUsername = decodeURIComponent(new URL(configuredUrl).username);
    migrationUsername = decodeURIComponent(new URL(configuredMigrationUrl).username);
  } catch {
    throw new Error("DATABASE_URL or MIGRATION_DATABASE_URL is invalid");
  }
  if (runtimeUsername === migrationUsername) {
    throw new Error("Self-hosted migrations require a separate DBA/migration role from DATABASE_URL");
  }
}

// Prefer the dedicated DBA/session URL so the application DATABASE_URL can
// remain a restricted runtime role. Preserve the legacy one-shot behavior for
// local and Supabase workflows that intentionally derive a direct URL from
// DATABASE_URL (including Supabase's transaction-pooler port conversion).
const sessionUrl = new URL(configuredMigrationUrl || configuredUrl!);
if (!configuredMigrationUrl
  && sessionUrl.port === "6543"
  && sessionUrl.hostname.endsWith(".pooler.supabase.com")) {
  sessionUrl.port = "5432";
}

const migrationUrl = sessionUrl.toString();
const connectionConfig = readMigrationDatabaseUrl({
  MIGRATION_DATABASE_URL: migrationUrl,
});
const connection = createMigrationPostgresClient(connectionConfig);

try {
  await connection`select 1`;
} catch {
  console.error(
    "Could not verify the PostgreSQL session connection. No migration was run.",
  );
  process.exit(1);
} finally {
  await connection.end({ timeout: 5 });
}

// The migration runner sees the derived session URL only in this process.
process.env.MIGRATION_DATABASE_URL = migrationUrl;
await import("./apply-migrations");
