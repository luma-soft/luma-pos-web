import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "@/db/migration-runner";

loadEnvConfig(process.cwd());

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let failed = false;
    child.stderr?.on("data", () => { failed = true; });
    child.on("error", () => reject(new Error(`${path.basename(command)} could not start`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed${failed ? "; details withheld" : ""}`));
    });
  });
}

function postgresBinaryPath(name: string): string {
  const prefix = spawnSync("brew", ["--prefix", "postgresql@17"], { encoding: "utf8" });
  if (prefix.status !== 0 || !prefix.stdout.trim()) {
    throw new Error("Homebrew PostgreSQL 17 is not installed; run bun db:setup:local first");
  }
  return path.join(prefix.stdout.trim(), "bin", name);
}

async function prepareBootstrapTarget(connectionString: string, expectedMigrationCount: number) {
  const targetConfig = readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: connectionString });
  const local = createMigrationPostgresClient(targetConfig);
  try {
    const migrationRows = await local.unsafe(
      "select count(*)::int as count from public._migrations",
    ) as Array<{ count: number }>;
    if (migrationRows[0]?.count !== expectedMigrationCount) {
      throw new Error("Local schema migration history does not match the configured database");
    }

    const populated: string[] = [];
    const tables = await local.unsafe(
      "select tablename from pg_tables where schemaname = 'public' and tablename not in ('_migrations', 'sync_relay_events', 'sync_relay_memberships')",
    ) as Array<{ tablename: string }>;
    for (const { tablename } of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error("Unexpected local database table name");
      const rows = await local.unsafe(`select count(*)::int as count from public."${tablename}"`) as Array<{ count: number }>;
      if (rows[0]?.count > 0) populated.push(tablename);
    }

    const bootstrapTables = new Set([
      "stores",
      "store_features",
      "store_settings",
      "catalog_sync_state",
      "catalog_delta_floors",
      "label_templates",
      "print_templates",
      "price_books",
    ]);
    if (populated.some((table) => !bootstrapTables.has(table))) {
      throw new Error("Local database contains business data; import stopped without changing it");
    }

    const seedStore = await local.unsafe(
      "select count(*)::int as count from public.stores where id = '00000000-0000-4000-8000-000000000001'",
    ) as Array<{ count: number }>;
    const storeCount = await local.unsafe("select count(*)::int as count from public.stores") as Array<{ count: number }>;
    if ((storeCount[0]?.count ?? 0) > 0 && seedStore[0]?.count !== storeCount[0]?.count) {
      throw new Error("Local database contains a non-bootstrap store; import stopped without changing it");
    }

    // Historical migrations seed a placeholder tenant and default print/pricing
    // rows. Remove only that bootstrap data before loading the configured store.
    await local.unsafe("truncate table public.stores cascade");
  } finally {
    await local.end({ timeout: 5 });
  }
}

const configuredUrl = process.env.DATABASE_URL?.trim();
if (!configuredUrl) throw new Error("DATABASE_URL is not configured");

const sourceUrl = new URL(configuredUrl);
if (sourceUrl.hostname.endsWith(".pooler.supabase.com") && sourceUrl.port === "6543") {
  sourceUrl.port = "5432";
}
const sourceConfig = readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: sourceUrl.toString() });

const localUser = userInfo().username;
if (!/^[A-Za-z0-9_.-]+$/.test(localUser)) {
  throw new Error("The local macOS account name cannot be used safely in a PostgreSQL URL");
}
const localUrl = new URL("postgresql://127.0.0.1:5432/lumapos_local");
localUrl.username = localUser;

const source = createMigrationPostgresClient(sourceConfig);
let expectedMigrationCount = 0;
try {
  const result = await source.unsafe("select count(*)::int as count from public._migrations") as Array<{ count: number }>;
  expectedMigrationCount = result[0]?.count ?? 0;
  if (expectedMigrationCount < 1) throw new Error("Configured database has no migration history");
} catch {
  console.error("Could not verify the configured PostgreSQL session connection. No data was copied.");
  process.exit(1);
} finally {
  await source.end({ timeout: 5 });
}

await prepareBootstrapTarget(localUrl.toString(), expectedMigrationCount);

const tempDir = await mkdtemp(path.join(tmpdir(), "lumapos-local-import-"));
const dumpPath = path.join(tempDir, "business-data.dump");
const sourceEnv = {
  ...process.env,
  PGPASSWORD: sourceConfig.password,
  PGSSLMODE: "require",
};
const pgDump = postgresBinaryPath("pg_dump");
const pgRestore = postgresBinaryPath("pg_restore");

try {
  await run(pgDump, [
    "--format=custom",
    "--data-only",
    "--no-owner",
    "--no-acl",
    "--schema=public",
    "--exclude-table=public._migrations",
    "--exclude-table=public.sync_relay_events",
    "--exclude-table=public.sync_relay_memberships",
    "--host", sourceConfig.hostname,
    "--port", String(sourceConfig.port),
    "--username", sourceConfig.username,
    "--dbname", sourceConfig.database,
    "--file", dumpPath,
  ], sourceEnv);

  await run(pgRestore, [
    "--data-only",
    "--disable-triggers",
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    "--dbname", localUrl.toString(),
    dumpPath,
  ], { ...process.env, PGSSLMODE: "disable" });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const local = createMigrationPostgresClient(readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: localUrl.toString() }));
try {
  const rows = await local.unsafe(`
    SELECT
      (SELECT count(*)::int FROM public.stores) AS stores,
      (SELECT count(*)::int FROM public.profiles) AS profiles,
      (SELECT count(*)::int FROM public.products) AS products,
      (SELECT count(*)::int FROM public.orders) AS orders,
      (SELECT count(*)::int FROM public._migrations) AS migrations
  `) as Array<{ stores: number; profiles: number; products: number; orders: number; migrations: number }>;
  const counts = rows[0];
  if (!counts || counts.stores < 1 || counts.profiles < 1 || counts.products < 1 || counts.migrations !== expectedMigrationCount) {
    throw new Error("Local data import verification did not match the expected store schema");
  }
  console.log(`Local snapshot imported: ${counts.stores} stores, ${counts.profiles} profiles, ${counts.products} products, ${counts.orders} orders; ${counts.migrations} migrations retained.`);
} finally {
  await local.end({ timeout: 5 });
}
