import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "./migration-runner";

const configuredUrl = process.env.DATABASE_URL?.trim();
if (!configuredUrl) {
  throw new Error("DATABASE_URL is not set");
}

const sessionUrl = new URL(configuredUrl);
if (
  sessionUrl.port === "6543" &&
  sessionUrl.hostname.endsWith(".pooler.supabase.com")
) {
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
