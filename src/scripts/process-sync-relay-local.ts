import { randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { loadEnvConfig } from "@next/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SyncRelaySubmit } from "@/lib/sync/relay";
import type { PosOrderRelayResult } from "@/lib/sync/process-pos-order-event";
import { createMigrationPostgresClient, readMigrationDatabaseUrl } from "@/db/migration-runner";

type RelayRow = {
  position: number | string;
  event_id: string;
  store_id: string;
  user_id: string;
  device_id: string;
  base_revision: string | null;
  payload: SyncRelaySubmit["payload"];
  attempt_count: number;
};

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 10;
const LEASE_SECONDS = 90;
const LOCAL_LOCK_KEY = 1_280_657_218;

loadEnvConfig(process.cwd());

if (process.env.LUMAPOS_LOCAL_AUTHORITY_CONFIRMED !== "true") {
  throw new Error(
    "The Mac sync processor is disabled until the local PostgreSQL snapshot has been reconciled and declared authoritative. Set LUMAPOS_LOCAL_AUTHORITY_CONFIRMED=true only after cutover readiness is verified.",
  );
}

const localAccount = userInfo().username;
if (!/^[A-Za-z0-9_.-]+$/.test(localAccount)) {
  throw new Error("The local macOS account name cannot be used safely in a PostgreSQL URL");
}
const localUrl = new URL("postgresql://127.0.0.1:5432/lumapos_local");
localUrl.username = localAccount;
process.env.DATABASE_URL = localUrl.toString();

const localConfig = readMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: localUrl.toString() });
const lockConnection = createMigrationPostgresClient(localConfig);
const [{ locked }] = await lockConnection.unsafe(
  "select pg_try_advisory_lock($1) as locked",
  [LOCAL_LOCK_KEY],
) as Array<{ locked: boolean }>;

if (!locked) {
  console.log("Another local sync processor already holds the Mac database lock.");
  await lockConnection.end({ timeout: 5 });
  process.exit(0);
}

let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

const workerId = `${hostname()}:${localAccount}:${randomUUID()}`;
const supabase = createSupabaseAdminClient();
const { processPosOrderRelayEvent } = await import("@/lib/sync/process-pos-order-event");

async function updateEvent(
  event: RelayRow,
  patch: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("sync_relay_events")
    .update(patch)
    .eq("position", String(event.position))
    .eq("status", "processing")
    .eq("lease_owner", workerId)
    .select("position")
    .maybeSingle();
  if (error || !data) throw new Error("Sync relay lease was lost before acknowledgement");
}

async function processEvent(event: RelayRow) {
  try {
    const result: PosOrderRelayResult = await processPosOrderRelayEvent({
      eventId: event.event_id,
      storeId: event.store_id,
      userId: event.user_id,
      deviceId: event.device_id,
      baseRevision: event.base_revision,
      payload: event.payload,
    });
    await updateEvent(event, {
      status: result.status,
      result: result.result,
      error_code: result.errorCode,
      processed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    });
  } catch {
    const delaySeconds = Math.min(900, 2 ** Math.min(event.attempt_count, 9));
    const availableAt = new Date(Date.now() + delaySeconds * 1_000).toISOString();
    try {
      await updateEvent(event, {
        status: "pending",
        available_at: availableAt,
        error_code: "SYNC_PROCESSOR_TEMPORARY",
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // The lease expires automatically if Supabase is unreachable.
    }
    console.error(`Sync event ${event.event_id} will retry after a temporary processing error.`);
  }
}

async function claimBatch(): Promise<RelayRow[]> {
  const { data, error } = await supabase.rpc("claim_sync_relay_events", {
    p_worker_id: workerId,
    p_batch_size: BATCH_SIZE,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw new Error("Could not claim sync relay events");
  return (data ?? []) as unknown as RelayRow[];
}

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
console.log("Mac sync processor started. Accepted commands are committed to local PostgreSQL.");

try {
  const healthRows = await lockConnection.unsafe(`
    SELECT
      (SELECT count(*)::int FROM public._migrations) AS migrations,
      (SELECT count(*)::int FROM public.stores WHERE status = 'active') AS active_stores,
      (SELECT count(*)::int FROM public.profiles WHERE is_active) AS active_profiles,
      (SELECT count(*)::int FROM public.products) AS products
  `) as Array<{ migrations: number; active_stores: number; active_profiles: number; products: number }>;
  const health = healthRows[0];
  if (!health || health.migrations < 1 || health.active_stores < 1 || health.active_profiles < 1 || health.products < 1) {
    throw new Error("Local PostgreSQL is missing its schema or business data snapshot");
  }

  do {
    const batch = await claimBatch();
    for (const event of batch) {
      await processEvent(event);
    }
    if (once) break;
    if (batch.length === 0) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  } while (running);
} finally {
  try {
    await lockConnection.unsafe("select pg_advisory_unlock($1)", [LOCAL_LOCK_KEY]);
  } finally {
    await lockConnection.end({ timeout: 5 });
  }
}
