import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";
import {
  createMigrationPostgresClient,
  readMigrationDatabaseUrl,
} from "@/db/migration-runner";

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 50;
const WORKER_LOCK_KEY = 1_280_657_219;
const once = process.argv.slice(2).includes("--once");

loadEnvConfig(process.cwd());

if (process.env.LUMAPOS_AUTH_PROVIDER !== "lumapos") {
  throw new Error("The PostgreSQL notification worker requires LUMAPOS_AUTH_PROVIDER=lumapos");
}
if (process.env.NOTIFICATION_QUEUE_PROVIDER !== "database") {
  throw new Error("The self-hosted notification worker requires NOTIFICATION_QUEUE_PROVIDER=database");
}
if (process.env.LUMAPOS_PRIMARY_DATABASE_CONFIRMED !== "true") {
  throw new Error("The notification worker is disabled until the PostgreSQL snapshot is reconciled and declared authoritative");
}

const configuredUrl = process.env.DATABASE_URL?.trim();
if (!configuredUrl) throw new Error("DATABASE_URL is not configured");
const parsedDatabaseUrl = new URL(configuredUrl);
if (parsedDatabaseUrl.hostname.endsWith(".supabase.com") || parsedDatabaseUrl.hostname.endsWith(".supabase.co")) {
  throw new Error("The self-hosted notification worker cannot use a Supabase database URL");
}
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
  console.log("Another LumaPOS notification worker already holds the PostgreSQL worker lock.");
  await connection.end({ timeout: 5 });
  process.exit(0);
}

const workerId = `${hostname()}:${randomUUID()}`;
const workerStartedAt = new Date();
let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

const [{ db, pool }, { notificationOutbox }] = await Promise.all([
  import("@/db"),
  import("@/db/schema"),
]);
const [{ recoverDueNotifications, processNotificationMessage }, { and, eq, isNull, lte, or }] = await Promise.all([
  import("@/lib/notifications/outbox"),
  import("drizzle-orm"),
]);

async function writeHeartbeat(state: "running" | "stopped") {
  await connection.unsafe(`
    INSERT INTO public.system_worker_heartbeats
      (worker_key, worker_id, state, started_at, last_seen_at, details)
    VALUES ('notification-outbox', $1, $2, $3, now(), '{}'::jsonb)
    ON CONFLICT (worker_key) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      state = EXCLUDED.state,
      started_at = EXCLUDED.started_at,
      last_seen_at = now(),
      details = EXCLUDED.details
  `, [workerId, state, workerStartedAt.toISOString()]);
}

async function processBatch() {
  await recoverDueNotifications(BATCH_SIZE);
  const now = new Date();
  const due = await db.select({ eventId: notificationOutbox.eventId })
    .from(notificationOutbox)
    .where(and(
      eq(notificationOutbox.status, "published"),
      lte(notificationOutbox.availableAt, now),
      or(isNull(notificationOutbox.leaseExpiresAt), lte(notificationOutbox.leaseExpiresAt, now)),
    ))
    .orderBy(notificationOutbox.availableAt, notificationOutbox.createdAt)
    .limit(BATCH_SIZE);

  for (const row of due) {
    const message = {
      version: 1 as const,
      eventId: row.eventId,
      deduplicationKey: `notification:${row.eventId}`,
      queuedAt: new Date().toISOString(),
    };
    try {
      await processNotificationMessage(message);
    } catch {
      console.error("A notification outbox event failed; the worker will retry it.");
    }
  }
  return due.length;
}

try {
  await writeHeartbeat("running");
  console.log("LumaPOS PostgreSQL notification worker started.");
  do {
    const processed = await processBatch();
    await writeHeartbeat("running");
    if (once) break;
    if (processed === 0) await delay(POLL_INTERVAL_MS);
  } while (running);
} finally {
  await writeHeartbeat("stopped").catch(() => undefined);
  await connection.unsafe("select pg_advisory_unlock($1)", [WORKER_LOCK_KEY]).catch(() => undefined);
  await connection.end({ timeout: 5 });
  await pool.end();
}
