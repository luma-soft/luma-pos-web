import { userInfo } from "node:os";
import { loadEnvConfig } from "@next/env";
import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "@/db/migration-runner";

loadEnvConfig(process.cwd());

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
const localConfig = readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: localUrl.toString() });
if (
  sourceConfig.hostname === localConfig.hostname
  && sourceConfig.port === localConfig.port
  && sourceConfig.database === localConfig.database
) {
  throw new Error("Configured source and local reconciliation target resolve to the same database");
}

const source = createMigrationPostgresClient(sourceConfig);
const local = createMigrationPostgresClient(localConfig);
const ignoredTables = new Set([
  "_migrations",
  "sync_relay_events",
  "sync_relay_memberships",
  "auth_credentials",
  "auth_sessions",
  "auth_session_tokens",
  "sync_events",
  "system_worker_heartbeats",
  "database_backup_runs",
  "media_objects",
  "product_media",
  "media_migration_runs",
  "media_migration_items",
]);
const aggregateQueries = [
  ["orders", "count(*)::text, coalesce(sum(total), 0)::numeric(30,2)::text, coalesce(sum(amount_paid), 0)::numeric(30,2)::text"],
  ["payments", "count(*)::text, coalesce(sum(amount), 0)::numeric(30,2)::text"],
  ["purchase_orders", "count(*)::text, coalesce(sum(total), 0)::numeric(30,2)::text, coalesce(sum(amount_paid), 0)::numeric(30,2)::text"],
  ["stock_levels", "count(*)::text, coalesce(sum(quantity), 0)::numeric(30,4)::text, coalesce(sum(reserved), 0)::numeric(30,4)::text"],
  ["stock_movements", "count(*)::text, coalesce(sum(quantity), 0)::numeric(30,4)::text"],
  ["cash_transactions", "count(*)::text, coalesce(sum(amount), 0)::numeric(30,2)::text"],
] as const;

async function publicTableNames(connection: typeof source) {
  const rows = await connection.unsafe(`
    select tablename from pg_tables
    where schemaname = 'public'
    order by tablename
  `) as Array<{ tablename: string }>;
  return new Set(rows.map((row) => row.tablename));
}

function normalizeDecimal(value: unknown) {
  const text = String(value ?? "0");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error("Unexpected aggregate value");
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

try {
  await Promise.all([
    source.unsafe("select 1"),
    local.unsafe("select 1"),
  ]);
  const [sourceTables, localTables] = await Promise.all([
    publicTableNames(source),
    publicTableNames(local),
  ]);
  const comparableTables = Array.from(sourceTables)
    .filter((name) => localTables.has(name) && !ignoredTables.has(name))
    .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name));
  const missingInSource = Array.from(localTables).filter((name) =>
    !sourceTables.has(name) && !ignoredTables.has(name),
  );
  const missingInLocal = Array.from(sourceTables).filter((name) =>
    !localTables.has(name) && !ignoredTables.has(name),
  );
  const countMismatches: Array<{ table: string; source: number; local: number }> = [];
  for (const table of comparableTables) {
    const [sourceRows, localRows] = await Promise.all([
      source.unsafe(`select count(*)::int as count from public."${table}"`) as Promise<Array<{ count: number }>>,
      local.unsafe(`select count(*)::int as count from public."${table}"`) as Promise<Array<{ count: number }>>,
    ]);
    if (sourceRows[0].count !== localRows[0].count) {
      countMismatches.push({ table, source: sourceRows[0].count, local: localRows[0].count });
    }
  }

  const financialMismatches: Array<{ table: string; source: string[]; local: string[] }> = [];
  for (const [table, selectList] of aggregateQueries) {
    if (!sourceTables.has(table) || !localTables.has(table)) continue;
    const [sourceRows, localRows] = await Promise.all([
      source.unsafe(`select ${selectList} from public."${table}"`) as Promise<Array<Record<string, unknown>>>,
      local.unsafe(`select ${selectList} from public."${table}"`) as Promise<Array<Record<string, unknown>>>,
    ]);
    const sourceValues = Object.values(sourceRows[0]).map(normalizeDecimal);
    const localValues = Object.values(localRows[0]).map(normalizeDecimal);
    if (JSON.stringify(sourceValues) !== JSON.stringify(localValues)) {
      financialMismatches.push({ table, source: sourceValues, local: localValues });
    }
  }

  const [sourceProfiles] = await source.unsafe(
    "select count(*)::int as count from public.profiles",
  ) as Array<{ count: number }>;
  const [localCredentials] = await local.unsafe(
    "select count(*)::int as count, count(*) filter (where must_reset_password)::int as reset_count from public.auth_credentials",
  ) as Array<{ count: number; reset_count: number }>;
  const identityMismatch = sourceProfiles.count !== localCredentials.count;
  const [sourceMigrations, localMigrations] = await Promise.all([
    source.unsafe("select name from public._migrations order by name") as Promise<Array<{ name: string }>>,
    local.unsafe("select name from public._migrations order by name") as Promise<Array<{ name: string }>>,
  ]);
  const sourceMigrationNames = sourceMigrations.map((row) => row.name);
  const localMigrationNames = localMigrations.map((row) => row.name);
  const localMigrationSet = new Set(localMigrationNames);
  const sourceMigrationsMissingLocally = sourceMigrationNames.filter((name) => !localMigrationSet.has(name));
  const extraLocalMigrationNames = localMigrationNames.filter((name) => !sourceMigrationNames.includes(name));
  const sourceMigrationsPresentLocally = sourceMigrationsMissingLocally.length === 0;

  const [{ relayTableExists, sourceNewInboxCount }] = await source.unsafe(`
    SELECT to_regclass('public.sync_relay_events') IS NOT NULL AS "relayTableExists",
      CASE WHEN to_regclass('public.sync_events') IS NOT NULL
        THEN (SELECT count(*)::int FROM public.sync_events) ELSE 0 END AS "sourceNewInboxCount"
  `) as Array<{ relayTableExists: boolean; sourceNewInboxCount: number }>;
  const sourceLegacyRelayCount = relayTableExists
    ? (await source.unsafe(
      "select count(*)::int as count from public.sync_relay_events",
    ) as Array<{ count: number }>)[0]?.count ?? 0
    : 0;
  if (sourceNewInboxCount > 0 && sourceLegacyRelayCount > 0) {
    throw new Error("Source contains both LumaPOS and legacy relay histories; reconcile them before cutover");
  }
  const sourceSyncStatusRows = sourceLegacyRelayCount > 0
    ? await source.unsafe(`
      SELECT CASE WHEN status = 'processing' THEN 'pending' ELSE status END AS status,
        count(*)::int AS count
      FROM public.sync_relay_events GROUP BY 1 ORDER BY 1
    `) as Array<{ status: string; count: number }>
    : sourceNewInboxCount > 0
      ? await source.unsafe(`
        SELECT status::text, count(*)::int AS count
        FROM public.sync_events GROUP BY status ORDER BY status
      `) as Array<{ status: string; count: number }>
      : [];
  const localSyncStatusRows = await local.unsafe(`
    SELECT status, count(*)::int AS count
    FROM public.sync_events GROUP BY status ORDER BY status
  `) as Array<{ status: string; count: number }>;
  const sourceSyncStatuses = Object.fromEntries(sourceSyncStatusRows.map((row) => [row.status, row.count]));
  const localSyncStatuses = Object.fromEntries(localSyncStatusRows.map((row) => [row.status, row.count]));
  const syncStatusMismatch = JSON.stringify(sourceSyncStatuses) !== JSON.stringify(localSyncStatuses);

  const report = {
    result: missingInSource.length || missingInLocal.length || countMismatches.length
      || financialMismatches.length || identityMismatch
      || syncStatusMismatch
      || !sourceMigrationsPresentLocally
      ? "mismatch"
      : "reconciled",
    sourceMigrationCount: sourceMigrationNames.length,
    localMigrationCount: localMigrationNames.length,
    sourceMigrationsPresentLocally,
    sourceMigrationsMissingLocally,
    extraLocalMigrationNames,
    comparableTableCount: comparableTables.length,
    missingInSource,
    missingInLocal,
    rowCountMismatches: countMismatches,
    financialAggregateMismatches: financialMismatches,
    profileCount: sourceProfiles.count,
    authCredentialCount: localCredentials.count,
    accountsRequiringPasswordReset: localCredentials.reset_count,
    sourceRelayReceiptsByStatus: sourceSyncStatuses,
    localSyncReceiptsByStatus: localSyncStatuses,
    syncReceiptStatusesMatch: !syncStatusMismatch,
    mediaAndOperationalTablesExcluded: Array.from(ignoredTables),
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "reconciled") process.exitCode = 2;
} finally {
  await Promise.all([
    source.end({ timeout: 5 }),
    local.end({ timeout: 5 }),
  ]);
}
