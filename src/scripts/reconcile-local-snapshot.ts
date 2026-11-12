import { loadEnvConfig } from "@next/env";
import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "@/db/migration-runner";
import { getLocalPostgresTarget } from "./local-postgres-target";

loadEnvConfig(process.cwd());

const configuredUrl = process.env.DATABASE_URL?.trim();
if (!configuredUrl) throw new Error("DATABASE_URL is not configured");
const sourceUrl = new URL(configuredUrl);
if (sourceUrl.hostname.endsWith(".pooler.supabase.com") && sourceUrl.port === "6543") {
  sourceUrl.port = "5432";
}
const sourceConfig = readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: sourceUrl.toString() });
const { databaseName: localDatabaseName, url: localUrl } = getLocalPostgresTarget();
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

async function publicTableColumns(connection: typeof source, table: string) {
  return await connection.unsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table]) as Array<{ column_name: string }>;
}

function quoteIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error("Unexpected PostgreSQL identifier while computing snapshot checksum");
  }
  return `"${value}"`;
}

async function tableDigest(
  connection: typeof source,
  table: string,
  columns: string[],
) {
  const keys = columns.map((_, index) => `$${index + 1}::text`);
  const values = columns.map((column) => `record.${quoteIdentifier(column)}`);
  const pairs = columns.flatMap((_, index) => [keys[index], values[index]]).join(", ");
  const [result] = await connection.unsafe(`
    SELECT count(*)::int AS count,
      md5(coalesce(string_agg(row_hash, '' ORDER BY row_hash), '')) AS checksum
    FROM (
      SELECT md5(jsonb_build_object(${pairs})::text) AS row_hash
      FROM public.${quoteIdentifier(table)} AS record
    ) AS hashed_rows
  `, columns) as Array<{ count: number; checksum: string }>;
  return result;
}

type AuthCredentialFingerprint = {
  profile_id: string;
  email_digest: string;
  normalized_email_digest: string;
  password_hash_digest: string;
  password_hash_type_digest: string;
  email_verified_at_digest: string;
  email_verified_at_millis_digest: string;
  reset_flag_digest: string;
};

async function authCredentialFingerprints(connection: typeof source, sourceSide: boolean) {
  const rows: AuthCredentialFingerprint[] = sourceSide
    ? await connection.unsafe(`
      SELECT p.id::text AS profile_id,
        md5(jsonb_build_array(nullif(btrim(u.email), ''))::text) AS email_digest,
        md5(jsonb_build_array(nullif(lower(btrim(u.email)), ''))::text) AS normalized_email_digest,
        md5(jsonb_build_array(nullif(btrim(u.encrypted_password), ''))::text) AS password_hash_digest,
        md5(jsonb_build_array('bcrypt')::text) AS password_hash_type_digest,
        md5(CASE WHEN u.email_confirmed_at IS NULL THEN '<null>' ELSE to_char(
          u.email_confirmed_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) END) AS email_verified_at_digest,
        md5(jsonb_build_array(date_trunc('milliseconds', u.email_confirmed_at))::text) AS email_verified_at_millis_digest,
        md5(jsonb_build_array(nullif(btrim(u.encrypted_password), '') IS NULL)::text) AS reset_flag_digest
      FROM public.profiles p
      LEFT JOIN auth.users u ON u.id = p.id
    `) as AuthCredentialFingerprint[]
    : await connection.unsafe(`
      SELECT profile_id::text AS profile_id,
        md5(jsonb_build_array(email)::text) AS email_digest,
        md5(jsonb_build_array(email_normalized)::text) AS normalized_email_digest,
        md5(jsonb_build_array(password_hash)::text) AS password_hash_digest,
        md5(jsonb_build_array(password_hash_type)::text) AS password_hash_type_digest,
        md5(CASE WHEN email_verified_at IS NULL THEN '<null>' ELSE to_char(
          email_verified_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) END) AS email_verified_at_digest,
        md5(jsonb_build_array(date_trunc('milliseconds', email_verified_at))::text) AS email_verified_at_millis_digest,
        md5(jsonb_build_array(must_reset_password)::text) AS reset_flag_digest
      FROM public.auth_credentials
    `) as AuthCredentialFingerprint[];
  return rows;
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
  await Promise.all([
    source.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"),
    local.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"),
  ]);
  await Promise.all([
    source.unsafe("SET LOCAL TIME ZONE 'UTC'"),
    local.unsafe("SET LOCAL TIME ZONE 'UTC'"),
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
  const rowContentMismatches: Array<{ table: string }> = [];
  const missingColumnsInLocal: Array<{ table: string; columns: string[] }> = [];
  for (const table of comparableTables) {
    const [sourceColumns, localColumns] = await Promise.all([
      publicTableColumns(source, table),
      publicTableColumns(local, table),
    ]);
    const targetColumnSet = new Set(localColumns.map((row) => row.column_name));
    const missingColumns = sourceColumns
      .map((row) => row.column_name)
      .filter((column) => !targetColumnSet.has(column));
    if (missingColumns.length > 0) {
      missingColumnsInLocal.push({ table, columns: missingColumns });
      continue;
    }

    const sourceColumnNames = sourceColumns.map((row) => row.column_name);
    const [sourceDigest, localDigest] = await Promise.all([
      tableDigest(source, table, sourceColumnNames),
      tableDigest(local, table, sourceColumnNames),
    ]);
    if (sourceDigest.count !== localDigest.count) {
      countMismatches.push({ table, source: sourceDigest.count, local: localDigest.count });
    }
    if (sourceDigest.checksum !== localDigest.checksum) {
      rowContentMismatches.push({ table });
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
  const [sourceMediaProviderRows, localMediaProviderRows] = await Promise.all([
    source.unsafe(`
      SELECT provider, count(*)::int AS count
      FROM public.media_objects
      GROUP BY provider ORDER BY provider
    `) as Promise<Array<{ provider: string; count: number }>>,
    local.unsafe(`
      SELECT provider, count(*)::int AS count
      FROM public.media_objects
      GROUP BY provider ORDER BY provider
    `) as Promise<Array<{ provider: string; count: number }>>,
  ]);
  const [localCredentials] = await local.unsafe(
    "select count(*)::int as count, count(*) filter (where must_reset_password)::int as reset_count from public.auth_credentials",
  ) as Array<{ count: number; reset_count: number }>;
  const [sourceAuthRows, localAuthRows] = await Promise.all([
    authCredentialFingerprints(source, true),
    authCredentialFingerprints(local, false),
  ]);
  const localAuthByProfile = new Map(localAuthRows.map((row) => [row.profile_id, row]));
  const sourceAuthProfileIds = new Set(sourceAuthRows.map((row) => row.profile_id));
  const authCredentialMismatches = {
    missingLocally: 0,
    missingAtSource: localAuthRows.filter((row) => !sourceAuthProfileIds.has(row.profile_id)).length,
    email: 0,
    normalizedEmail: 0,
    passwordHash: 0,
    passwordHashType: 0,
    emailVerifiedAt: 0,
    emailVerifiedAtSubMillisecondPrecision: 0,
    mustResetPassword: 0,
  };
  for (const sourceRow of sourceAuthRows) {
    const localRow = localAuthByProfile.get(sourceRow.profile_id);
    if (!localRow) {
      authCredentialMismatches.missingLocally++;
      continue;
    }
    if (sourceRow.email_digest !== localRow.email_digest) authCredentialMismatches.email++;
    if (sourceRow.normalized_email_digest !== localRow.normalized_email_digest) authCredentialMismatches.normalizedEmail++;
    if (sourceRow.password_hash_digest !== localRow.password_hash_digest) authCredentialMismatches.passwordHash++;
    if (sourceRow.password_hash_type_digest !== localRow.password_hash_type_digest) authCredentialMismatches.passwordHashType++;
    if (sourceRow.email_verified_at_digest !== localRow.email_verified_at_digest) {
      if (sourceRow.email_verified_at_millis_digest === localRow.email_verified_at_millis_digest) {
        authCredentialMismatches.emailVerifiedAtSubMillisecondPrecision++;
      } else {
        authCredentialMismatches.emailVerifiedAt++;
      }
    }
    if (sourceRow.reset_flag_digest !== localRow.reset_flag_digest) authCredentialMismatches.mustResetPassword++;
  }
  const authCredentialMismatch = Object.entries(authCredentialMismatches)
    .some(([field, count]) => field !== "emailVerifiedAtSubMillisecondPrecision" && count > 0);
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
      || rowContentMismatches.length || missingColumnsInLocal.length
      || financialMismatches.length || identityMismatch || authCredentialMismatch
      || syncStatusMismatch
      || !sourceMigrationsPresentLocally
      ? "mismatch"
      : "reconciled",
    localDatabase: localDatabaseName,
    sourceMigrationCount: sourceMigrationNames.length,
    localMigrationCount: localMigrationNames.length,
    sourceMigrationsPresentLocally,
    sourceMigrationsMissingLocally,
    extraLocalMigrationNames,
    comparableTableCount: comparableTables.length,
    missingInSource,
    missingInLocal,
    missingColumnsInLocal,
    rowCountMismatches: countMismatches,
    rowContentMismatches,
    financialAggregateMismatches: financialMismatches,
    sourceMediaObjectsByProvider: Object.fromEntries(sourceMediaProviderRows.map((row) => [row.provider, row.count])),
    localMediaObjectsByProvider: Object.fromEntries(localMediaProviderRows.map((row) => [row.provider, row.count])),
    profileCount: sourceProfiles.count,
    authCredentialCount: localCredentials.count,
    accountsRequiringPasswordReset: localCredentials.reset_count,
    authCredentialsMatch: !authCredentialMismatch,
    authCredentialMismatches,
    sourceRelayReceiptsByStatus: sourceSyncStatuses,
    localSyncReceiptsByStatus: localSyncStatuses,
    syncReceiptStatusesMatch: !syncStatusMismatch,
    mediaAndOperationalTablesExcluded: Array.from(ignoredTables),
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "reconciled") process.exitCode = 2;
} finally {
  await Promise.allSettled([
    source.unsafe("ROLLBACK"),
    local.unsafe("ROLLBACK"),
  ]);
  await Promise.all([
    source.end({ timeout: 5 }),
    local.end({ timeout: 5 }),
  ]);
}
