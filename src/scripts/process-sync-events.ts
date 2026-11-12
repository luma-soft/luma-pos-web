import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { loadEnvConfig } from "@next/env";
import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "@/db/migration-runner";
import { assertSelfHostedPrimaryDatabase } from "@/db/self-hosted-primary";
import { authProvider } from "@/lib/auth/provider";
import {
  POS_ORDER_SYNC_COMMAND,
  SERVICE_FIELD_MUTATION_SYNC_COMMAND,
  type POSOrderSyncPayload,
} from "@/lib/sync/relay";
import type { PosOrderRelayResult } from "@/lib/sync/process-pos-order-event";
import type { ServiceFieldRelayResult } from "@/lib/sync/process-service-field-event";

type SyncEvent = {
  position: string;
  event_id: string;
  store_id: string;
  user_id: string;
  device_id: string;
  command_type: string;
  base_revision: string | null;
  payload: unknown;
  attempt_count: number;
};

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 10;
const LEASE_SECONDS = 90;
const WORKER_LOCK_KEY = 1_280_657_218;

loadEnvConfig(process.cwd());

if (authProvider() !== "lumapos") {
  throw new Error("The PostgreSQL sync worker requires LUMAPOS_AUTH_PROVIDER=lumapos");
}
if (process.env.LUMAPOS_SYNC_INBOX_ENABLED !== "true") {
  throw new Error("The PostgreSQL sync worker requires LUMAPOS_SYNC_INBOX_ENABLED=true");
}
if (process.env.LUMAPOS_PRIMARY_DATABASE_CONFIRMED !== "true") {
  throw new Error(
    "The sync worker is disabled until the PostgreSQL snapshot has been reconciled and declared authoritative.",
  );
}
assertSelfHostedPrimaryDatabase(process.env);

const configuredUrl = process.env.DATABASE_URL?.trim();
if (!configuredUrl) throw new Error("DATABASE_URL is not configured");
const sessionUrl = new URL(configuredUrl);
if (sessionUrl.hostname.endsWith(".pooler.supabase.com") && sessionUrl.port === "6543") {
  sessionUrl.port = "5432";
}
const connection = createMigrationPostgresClient(readMigrationDatabaseUrl({
  MIGRATION_DATABASE_URL: sessionUrl.toString(),
}));
const [{ locked }] = await connection.unsafe(
  "select pg_try_advisory_lock($1) as locked",
  [WORKER_LOCK_KEY],
) as Array<{ locked: boolean }>;

if (!locked) {
  console.log("Another LumaPOS sync worker already holds the PostgreSQL worker lock.");
  await connection.end({ timeout: 5 });
  process.exit(0);
}

let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

const workerId = `${hostname()}:${randomUUID()}`;
const workerStartedAt = new Date();
const { processPosOrderRelayEvent } = await import("@/lib/sync/process-pos-order-event");
const { processServiceFieldRelayEvent } = await import("@/lib/sync/process-service-field-event");

async function writeHeartbeat(state: "running" | "stopped") {
  await connection.unsafe(`
    INSERT INTO public.system_worker_heartbeats
      (worker_key, worker_id, state, started_at, last_seen_at, details)
    VALUES ('sync-inbox', $1, $2, $3, now(), '{}'::jsonb)
    ON CONFLICT (worker_key) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      state = EXCLUDED.state,
      started_at = EXCLUDED.started_at,
      last_seen_at = now(),
      details = EXCLUDED.details
  `, [workerId, state, workerStartedAt.toISOString()]);
}

async function claimBatch(): Promise<SyncEvent[]> {
  return await connection.unsafe(`
    WITH candidates AS (
      SELECT position
      FROM public.sync_events
      WHERE (
        (status = 'pending' AND available_at <= now())
        OR (status = 'processing' AND lease_expires_at <= now())
      )
        AND (command_type <> $4 OR $5::boolean)
      ORDER BY position
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    )
    UPDATE public.sync_events AS events
    SET status = 'processing',
        lease_owner = $1,
        lease_expires_at = now() + ($3::text || ' seconds')::interval,
        attempt_count = events.attempt_count + 1,
        updated_at = now()
    FROM candidates
    WHERE events.position = candidates.position
    RETURNING events.position::text, events.event_id::text, events.store_id::text,
      events.user_id::text, events.device_id, events.command_type,
      events.base_revision::text, events.payload, events.attempt_count
  `, [
    workerId,
    BATCH_SIZE,
    LEASE_SECONDS,
    SERVICE_FIELD_MUTATION_SYNC_COMMAND,
    process.env.LUMAPOS_SERVICE_FIELD_SYNC_ENABLED === "true",
  ]) as SyncEvent[];
}

async function updateEvent(event: SyncEvent, input: {
  status: "pending" | "accepted" | "rejected" | "conflict";
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  availableAt?: Date;
  processedAt?: Date | null;
}) {
  const rows = await connection.unsafe(`
    UPDATE public.sync_events
    SET status = $1,
        result = $2::jsonb,
        error_code = $3,
        available_at = COALESCE($4::timestamptz, available_at),
        processed_at = $5::timestamptz,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE position = $6::bigint
      AND status = 'processing'
      AND lease_owner = $7
    RETURNING position
  `, [
    input.status,
    input.result == null ? null : JSON.stringify(input.result),
    input.errorCode ?? null,
    input.availableAt?.toISOString() ?? null,
    input.processedAt?.toISOString() ?? null,
    event.position,
    workerId,
  ]) as Array<{ position: string }>;
  if (rows.length === 0) throw new Error("Sync event lease was lost before acknowledgement");
}

async function processEvent(event: SyncEvent) {
  try {
    let result: PosOrderRelayResult | ServiceFieldRelayResult;
    if (event.command_type === POS_ORDER_SYNC_COMMAND) {
      result = await processPosOrderRelayEvent({
        eventId: event.event_id,
        storeId: event.store_id,
        userId: event.user_id,
        deviceId: event.device_id,
        baseRevision: event.base_revision,
        payload: event.payload as POSOrderSyncPayload,
      });
    } else if (event.command_type === SERVICE_FIELD_MUTATION_SYNC_COMMAND) {
      result = await processServiceFieldRelayEvent({
        storeId: event.store_id,
        userId: event.user_id,
        payload: event.payload,
      });
    } else {
      result = { status: "rejected", result: null, errorCode: "SYNC_COMMAND_UNSUPPORTED" };
    }

    await updateEvent(event, {
      status: result.status,
      result: result.result,
      errorCode: result.errorCode,
      processedAt: new Date(),
    });
  } catch {
    const delaySeconds = Math.min(900, 2 ** Math.min(event.attempt_count, 9));
    try {
      await updateEvent(event, {
        status: "pending",
        errorCode: "SYNC_PROCESSOR_TEMPORARY",
        availableAt: new Date(Date.now() + delaySeconds * 1_000),
      });
    } catch {
      // The lease will expire and another supervised worker can recover it.
    }
    console.error(`Sync event ${event.event_id} will retry after a temporary processing error.`);
  }
}

const once = process.argv.slice(2).includes("--once");
console.log("LumaPOS PostgreSQL sync worker started.");

try {
  const healthRows = await connection.unsafe(`
    SELECT
      (SELECT count(*)::int FROM public._migrations) AS migrations,
      (SELECT count(*)::int FROM public.stores WHERE status = 'active') AS active_stores,
      (SELECT count(*)::int FROM public.profiles WHERE is_active) AS active_profiles,
      (SELECT count(*)::int FROM public.sync_events) AS sync_events
  `) as Array<{ migrations: number; active_stores: number; active_profiles: number; sync_events: number }>;
  const health = healthRows[0];
  if (!health || health.migrations < 1 || health.active_stores < 1 || health.active_profiles < 1) {
    throw new Error("PostgreSQL is missing its schema or business snapshot");
  }
  await writeHeartbeat("running");

  do {
    const batch = await claimBatch();
    for (const event of batch) await processEvent(event);
    await writeHeartbeat("running");
    if (once) break;
    if (batch.length === 0) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  } while (running);
} finally {
  try {
    await writeHeartbeat("stopped").catch(() => undefined);
    await connection.unsafe("select pg_advisory_unlock($1)", [WORKER_LOCK_KEY]);
  } finally {
    await connection.end({ timeout: 5 });
  }
}
