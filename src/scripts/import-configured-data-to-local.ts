import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

async function prepareBootstrapTarget(connectionString: string, sourceMigrationNames: string[]): Promise<string[]> {
  const targetConfig = readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: connectionString });
  const local = createMigrationPostgresClient(targetConfig);
  try {
    const migrationRows = await local.unsafe(
      "select name from public._migrations order by name",
    ) as Array<{ name: string }>;
    const localMigrationNames = migrationRows.map((row) => row.name);
    const localMigrationSet = new Set(localMigrationNames);
    if (sourceMigrationNames.some((name) => !localMigrationSet.has(name))) {
      throw new Error("Local schema is missing a migration already applied to the configured database");
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

    if (!process.argv.includes("--confirm-bootstrap-target")) {
      throw new Error("Import requires --confirm-bootstrap-target after verifying the target is bootstrap-only");
    }

    // Historical migrations seed a placeholder tenant and default print/pricing
    // rows. Remove only that bootstrap data before loading the configured store.
    await local.unsafe("truncate table public.stores cascade");
    return localMigrationNames;
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

type LegacyAuthIdentity = {
  profileId: string;
  email: string | null;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};

type LegacyRelayEvent = {
  position: string;
  event_id: string;
  store_id: string;
  user_id: string;
  device_id: string;
  command_type: string;
  base_revision: string | null;
  payload: unknown;
  status: "pending" | "processing" | "accepted" | "rejected" | "conflict";
  result: Record<string, unknown> | null;
  error_code: string | null;
  attempt_count: number;
  available_at: Date;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
};

async function verifySourceSyncHistory(source: ReturnType<typeof createMigrationPostgresClient>) {
  const [{ relayTableExists, inboxTableExists }] = await source.unsafe(`
    SELECT to_regclass('public.sync_relay_events') IS NOT NULL AS "relayTableExists",
      to_regclass('public.sync_events') IS NOT NULL AS "inboxTableExists"
  `) as Array<{ relayTableExists: boolean; inboxTableExists: boolean }>;
  const legacyRows = relayTableExists
    ? (await source.unsafe(
      "select count(*)::int as count from public.sync_relay_events",
    ) as Array<{ count: number }>)[0]?.count ?? 0
    : 0;
  const inboxRows = inboxTableExists
    ? (await source.unsafe(
      "select count(*)::int as count from public.sync_events",
    ) as Array<{ count: number }>)[0]?.count ?? 0
    : 0;
  if (legacyRows > 0 && inboxRows > 0) {
    throw new Error("Source contains both LumaPOS and legacy relay histories; reconcile them before import");
  }
  return { legacyRows, inboxRows };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function syncPayloadHash(event: LegacyRelayEvent) {
  return createHash("sha256").update(stableJson({
    commandType: event.command_type,
    payload: event.payload,
    baseRevision: event.base_revision == null ? null : String(event.base_revision),
  })).digest("hex");
}

async function importLegacyRelayReceipts(source: ReturnType<typeof createMigrationPostgresClient>, local: ReturnType<typeof createMigrationPostgresClient>) {
  const [{ relayTableExists }] = await source.unsafe(`
    SELECT to_regclass('public.sync_relay_events') IS NOT NULL AS "relayTableExists"
  `) as Array<{ relayTableExists: boolean }>;
  if (!relayTableExists) return 0;
  const [{ sourceInboxExists }] = await source.unsafe(`
    SELECT to_regclass('public.sync_events') IS NOT NULL AS "sourceInboxExists"
  `) as Array<{ sourceInboxExists: boolean }>;
  const sourceNewInboxRows = sourceInboxExists
    ? (await source.unsafe(
      "select count(*)::int as count from public.sync_events",
    ) as Array<{ count: number }>)[0]?.count ?? 0
    : 0;
  const [{ legacyEventCount }] = await source.unsafe(
    "select count(*)::int as \"legacyEventCount\" from public.sync_relay_events",
  ) as Array<{ legacyEventCount: number }>;
  if (sourceNewInboxRows > 0 && legacyEventCount > 0) {
    throw new Error("Source contains both LumaPOS and legacy relay histories; reconcile them before import");
  }
  if (legacyEventCount === 0) return 0;

  const [{ targetInboxRows }] = await local.unsafe(
    "select count(*)::int as \"targetInboxRows\" from public.sync_events",
  ) as Array<{ targetInboxRows: number }>;
  if (targetInboxRows > 0) {
    throw new Error("Local sync inbox is not empty; refusing to merge two relay histories");
  }

  let afterPosition = "0";
  let imported = 0;
  while (true) {
    const rows = await source.unsafe(`
      SELECT position::text, event_id::text, store_id::text, user_id::text,
        device_id, command_type, base_revision::text, payload, status,
        result, error_code, attempt_count, available_at, created_at,
        updated_at, processed_at
      FROM public.sync_relay_events
      WHERE position > $1::bigint
      ORDER BY position
      LIMIT 500
    `, [afterPosition]) as LegacyRelayEvent[];
    if (rows.length === 0) break;
    for (const event of rows) {
      const status = event.status === "processing" ? "pending" : event.status;
      const availableAt = event.status === "processing" ? new Date() : event.available_at;
      const inserted = await local.unsafe(`
        INSERT INTO public.sync_events (
          store_id, event_id, user_id, device_id, command_type, base_revision,
          payload, payload_hash, status, result, error_code, attempt_count,
          available_at, created_at, updated_at, processed_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6::bigint,
          $7::jsonb, $8, $9::sync_event_status, $10::jsonb, $11, $12,
          $13::timestamptz, $14::timestamptz, $15::timestamptz, $16::timestamptz
        )
        ON CONFLICT (store_id, event_id) DO NOTHING
        RETURNING position
      `, [
        event.store_id,
        event.event_id,
        event.user_id,
        event.device_id,
        event.command_type,
        event.base_revision,
        JSON.stringify(event.payload),
        syncPayloadHash(event),
        status,
        event.result == null ? null : JSON.stringify(event.result),
        event.error_code,
        event.attempt_count,
        availableAt.toISOString(),
        event.created_at.toISOString(),
        event.updated_at.toISOString(),
        status === "pending" ? null : event.processed_at?.toISOString() ?? null,
      ]) as Array<{ position: string }>;
      if (inserted.length !== 1) throw new Error("A relay receipt collided with the local sync inbox");
      imported++;
    }
    afterPosition = rows.at(-1)!.position;
  }
  return imported;
}

function validateLegacyAuthIdentities(rows: LegacyAuthIdentity[]) {
  const seenEmails = new Set<string>();
  return rows.map((row) => {
    const email = row.email?.trim() || null;
    const emailNormalized = email?.toLowerCase() ?? null;
    if (emailNormalized && seenEmails.has(emailNormalized)) {
      throw new Error("Legacy Auth identities contain duplicate email addresses");
    }
    if (emailNormalized) seenEmails.add(emailNormalized);

    const passwordHash = row.passwordHash?.trim() || null;
    if (passwordHash && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
      throw new Error("A legacy Auth password hash uses an unsupported algorithm");
    }

    return {
      profileId: row.profileId,
      email,
      emailNormalized,
      passwordHash,
      passwordHashType: "bcrypt",
      emailVerifiedAt: row.emailVerifiedAt,
      mustResetPassword: !passwordHash,
    };
  });
}

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
  throw new Error("Configured source and local import target resolve to the same PostgreSQL database");
}

const source = createMigrationPostgresClient(sourceConfig);
let sourceMigrationNames: string[] = [];
let localMigrationNames: string[] = [];
let sourceInboxEventCount = 0;
let authCredentials: ReturnType<typeof validateLegacyAuthIdentities> = [];
let sourceReady = true;
try {
  const migrations = await source.unsafe(
    "select name from public._migrations order by name",
  ) as Array<{ name: string }>;
  sourceMigrationNames = migrations.map((row) => row.name);
  if (sourceMigrationNames.length < 1) throw new Error("Configured database has no migration history");
  const syncHistory = await verifySourceSyncHistory(source);
  sourceInboxEventCount = syncHistory.inboxRows;
  const identities = await source.unsafe(`
    SELECT
      p.id::text AS "profileId",
      u.email,
      u.encrypted_password AS "passwordHash",
      u.email_confirmed_at AS "emailVerifiedAt"
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.id
  `) as LegacyAuthIdentity[];
  authCredentials = validateLegacyAuthIdentities(identities);
} catch {
  sourceReady = false;
}
if (!sourceReady) {
  await source.end({ timeout: 5 });
  console.error("Could not verify the PostgreSQL session or read compatible Auth identities. No local data was changed.");
  process.exit(1);
}

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
    "--exclude-table=public.auth_credentials",
    "--exclude-table=public.auth_sessions",
    "--exclude-table=public.auth_session_tokens",
    "--exclude-table=public.system_worker_heartbeats",
    "--exclude-table=public.database_backup_runs",
    "--host", sourceConfig.hostname,
    "--port", String(sourceConfig.port),
    "--username", sourceConfig.username,
    "--dbname", sourceConfig.database,
    "--file", dumpPath,
  ], sourceEnv);

  // Only the known bootstrap-only target may be cleared, and only after the
  // complete source dump has been created successfully.
  localMigrationNames = await prepareBootstrapTarget(localUrl.toString(), sourceMigrationNames);

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

const local = createMigrationPostgresClient(localConfig);
try {
  await local.unsafe(`
    INSERT INTO public.auth_credentials (
      profile_id, email, email_normalized, password_hash, password_hash_type,
      email_verified_at, must_reset_password
    )
    SELECT
      profile_id, email, email_normalized, password_hash, password_hash_type,
      email_verified_at, must_reset_password
    FROM jsonb_to_recordset($1::jsonb) AS imported(
      profile_id uuid,
      email text,
      email_normalized text,
      password_hash text,
      password_hash_type varchar(16),
      email_verified_at timestamptz,
      must_reset_password boolean
    )
  `, [JSON.stringify(authCredentials)]);

  const importedSyncReceipts = await importLegacyRelayReceipts(source, local);
  const expectedSyncReceipts = sourceInboxEventCount + importedSyncReceipts;

  const rows = await local.unsafe(`
    SELECT
      (SELECT count(*)::int FROM public.stores) AS stores,
      (SELECT count(*)::int FROM public.profiles) AS profiles,
      (SELECT count(*)::int FROM public.auth_credentials) AS auth_credentials,
      (SELECT count(*)::int FROM public.auth_credentials WHERE must_reset_password) AS auth_password_resets,
      (SELECT count(*)::int FROM public.products) AS products,
      (SELECT count(*)::int FROM public.orders) AS orders,
      (SELECT count(*)::int FROM public.sync_events) AS sync_events,
      (SELECT count(*)::int FROM public._migrations) AS migrations
  `) as Array<{ stores: number; profiles: number; auth_credentials: number; auth_password_resets: number; products: number; orders: number; sync_events: number; migrations: number }>;
  const counts = rows[0];
  if (
    !counts ||
    counts.stores < 1 ||
    counts.profiles < 1 ||
    counts.auth_credentials !== authCredentials.length ||
    counts.sync_events !== expectedSyncReceipts ||
    counts.products < 1 ||
    counts.migrations !== localMigrationNames.length
  ) {
    throw new Error("Local data import verification did not match the expected store schema");
  }
  console.log(`Local snapshot imported: ${counts.stores} stores, ${counts.profiles} profiles, ${counts.auth_credentials} auth identities (${counts.auth_password_resets} require password reset), ${counts.products} products, ${counts.orders} orders, ${counts.sync_events} sync receipts (${importedSyncReceipts} legacy relay receipts copied); ${counts.migrations} migrations retained.`);
} finally {
  await Promise.all([
    local.end({ timeout: 5 }),
    source.end({ timeout: 5 }),
  ]);
}
