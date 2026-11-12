import "server-only";

import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { systemWorkerHeartbeats } from "@/db/schema";
import { authProvider } from "@/lib/auth/provider";
import { getLocalMediaConfig, getMediaWriteProvider } from "@/lib/media/config";

type WorkerKey = "sync-inbox" | "notification-outbox" | "database-backup";
type WorkerStatus = { status: "online" | "offline"; lastSeenAt: string | null };

export type SelfHostedReadiness = {
  status: "ready" | "not_ready";
  database: "ready" | "not_ready";
  missingDatabasePrivileges: string[];
  workers: Partial<Record<WorkerKey, WorkerStatus>>;
  media: {
    status: "ready" | "not_ready" | "not_required";
    provider: "local" | "r2" | null;
    blockers: Record<string, boolean>;
  };
  missingWorkers: WorkerKey[];
  missingMedia: string[];
};

function resultRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

async function readLocalMediaReadiness() {
  let root: string;
  try {
    root = getLocalMediaConfig().root;
  } catch {
    return { configurationValid: false, rootAccessible: false };
  }

  try {
    const rootStats = await stat(root);
    if (!rootStats.isDirectory()) {
      return { configurationValid: true, rootAccessible: false };
    }
    await access(root, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
    return { configurationValid: true, rootAccessible: true };
  } catch {
    return { configurationValid: true, rootAccessible: false };
  }
}

export async function readSelfHostedReadiness(): Promise<SelfHostedReadiness> {
  await db.execute(sql`select 1`);
  if (authProvider() !== "lumapos") {
    return {
      status: "ready",
      database: "ready",
      missingDatabasePrivileges: [],
      workers: {},
      media: { status: "not_required", provider: null, blockers: {} },
      missingWorkers: [],
      missingMedia: [],
    };
  }

  const mediaWriteProvider = getMediaWriteProvider();
  const localMediaReadiness = mediaWriteProvider === "local"
    ? await readLocalMediaReadiness()
    : null;
  const workerKeys: WorkerKey[] = [
    "sync-inbox",
    "notification-outbox",
    "database-backup",
  ];
  const [roleRows, workerRows, mediaRows] = await Promise.all([
    db.execute(sql`
      SELECT
        runtime_account.rolsuper AS "superuser",
        runtime_account.rolcreatedb AS "createDatabase",
        runtime_account.rolcreaterole AS "createRoles",
        runtime_account.rolreplication AS "replication",
        runtime_account.rolbypassrls AS "bypassRls",
        has_database_privilege(current_user, current_database(), 'CREATE') AS "databaseCreate",
        has_schema_privilege(current_user, 'public', 'CREATE') AS "publicSchemaCreate",
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_database database
          WHERE database.datname = current_database()
            AND database.datdba = runtime_account.oid
        ) AS "ownsDatabase",
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_namespace namespace
          WHERE namespace.nspname = 'public'
            AND namespace.nspowner = runtime_account.oid
        ) AS "ownsPublicSchema",
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_class relation
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relowner = runtime_account.oid
        ) OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_proc routine
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
          WHERE namespace.nspname = 'public'
            AND routine.proowner = runtime_account.oid
        ) OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_type object_type
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object_type.typnamespace
          WHERE namespace.nspname = 'public'
            AND object_type.typowner = runtime_account.oid
        ) AS "ownsPublicObjects"
      FROM pg_catalog.pg_roles AS runtime_account
      WHERE runtime_account.rolname = current_user
    `),
    db.select({
      workerKey: systemWorkerHeartbeats.workerKey,
      state: systemWorkerHeartbeats.state,
      lastSeenAt: systemWorkerHeartbeats.lastSeenAt,
    }).from(systemWorkerHeartbeats).where(inArray(systemWorkerHeartbeats.workerKey, workerKeys)),
    db.execute(sql`
      SELECT
        EXISTS (
          SELECT 1 FROM public.media_objects
          WHERE provider = 'supabase'
            AND (status <> 'deleted' OR storage_deleted_at IS NULL)
        ) AS "supabaseManagedMedia",
        EXISTS (
          SELECT 1 FROM public.media_objects
          WHERE provider <> 'local'
            AND (status <> 'deleted' OR storage_deleted_at IS NULL)
        ) AS "nonLocalManagedMedia",
        EXISTS (
          SELECT 1 FROM public.service_attachments
          WHERE media_object_id IS NULL
            AND (deleted_at IS NULL OR storage_deleted_at IS NULL)
        ) AS "legacyServiceAttachments",
        EXISTS (
          SELECT 1 FROM public.service_customer_request_attachments
          WHERE media_object_id IS NULL
        ) AS "legacyCustomerRequestAttachments",
        EXISTS (
          SELECT 1 FROM public.service_customer_request_storage_cleanup
          WHERE provider = 'supabase'
        ) AS "pendingSupabaseRequestCleanup",
        EXISTS (
          SELECT 1 FROM public.service_customer_request_storage_cleanup
          WHERE provider <> 'local'
        ) AS "pendingNonLocalRequestCleanup",
        EXISTS (
          SELECT 1 FROM public.ai_chat_messages message
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(message.attachments) = 'array'
              THEN message.attachments ELSE '[]'::jsonb END
          ) AS attachment(value)
          WHERE attachment.value->>'mediaId' IS NULL
            AND (
              attachment.value->>'bucket' IS NOT NULL
              OR attachment.value->>'path' IS NOT NULL
              OR attachment.value->>'id' IS NOT NULL
              OR attachment.value->>'signedUrl' IS NOT NULL
            )
        ) AS "legacyAiAttachments",
        EXISTS (
          SELECT 1 FROM public.media_migration_items
          WHERE target_provider = 'local'
            AND status IN ('inventoried', 'copied', 'verified', 'failed', 'quarantined')
        ) AS "unfinishedLocalMediaMigration"
    `),
  ]);

  const roleState = resultRows(roleRows)[0] ?? {};
  const missingDatabasePrivileges = [
    ...(roleState.superuser === false ? [] : ["superuser"]),
    ...(roleState.createDatabase === false ? [] : ["createDatabase"]),
    ...(roleState.createRoles === false ? [] : ["createRoles"]),
    ...(roleState.replication === false ? [] : ["replication"]),
    ...(roleState.bypassRls === true ? [] : ["bypassRls"]),
    ...(roleState.databaseCreate === false ? [] : ["databaseCreate"]),
    ...(roleState.publicSchemaCreate === false ? [] : ["publicSchemaCreate"]),
    ...(roleState.ownsDatabase === false ? [] : ["ownsDatabase"]),
    ...(roleState.ownsPublicSchema === false ? [] : ["ownsPublicSchema"]),
    ...(roleState.ownsPublicObjects === false ? [] : ["ownsPublicObjects"]),
  ];

  const now = Date.now();
  const workers: Record<WorkerKey, WorkerStatus> = {
    "sync-inbox": { status: "offline", lastSeenAt: null },
    "notification-outbox": { status: "offline", lastSeenAt: null },
    "database-backup": { status: "offline", lastSeenAt: null },
  };
  for (const worker of workerRows) {
    const online = worker.state === "running" && now - worker.lastSeenAt.getTime() < 45_000;
    workers[worker.workerKey as WorkerKey] = {
      status: online ? "online" : "offline",
      lastSeenAt: worker.lastSeenAt.toISOString(),
    };
  }
  const missingWorkers = workerKeys.filter((workerKey) => workers[workerKey].status !== "online");
  const mediaState = resultRows(mediaRows)[0] ?? {};
  const blockers: Record<string, boolean> = {
    externalMediaReview:
      process.env.LUMAPOS_EXTERNAL_MEDIA_REVIEW_CONFIRMED !== "true",
    supabaseManagedMedia: mediaState.supabaseManagedMedia === true,
    legacyServiceAttachments: mediaState.legacyServiceAttachments === true,
    legacyCustomerRequestAttachments: mediaState.legacyCustomerRequestAttachments === true,
    pendingRemoteRequestCleanup: mediaWriteProvider === "local"
      ? mediaState.pendingNonLocalRequestCleanup === true
      : mediaState.pendingSupabaseRequestCleanup === true,
    legacyAiAttachments: mediaState.legacyAiAttachments === true,
    ...(mediaWriteProvider === "local" ? {
      nonLocalManagedMedia: mediaState.nonLocalManagedMedia === true,
      unfinishedLocalMediaMigration: mediaState.unfinishedLocalMediaMigration === true,
      localMediaConfiguration: localMediaReadiness?.configurationValid !== true,
      localMediaRoot: localMediaReadiness?.configurationValid === true
        && localMediaReadiness.rootAccessible !== true,
    } : {}),
  };
  const missingMedia = Object.entries(blockers)
    .filter(([, blocked]) => blocked)
    .map(([blocker]) => blocker);

  return {
    status: missingDatabasePrivileges.length === 0
      && missingWorkers.length === 0
      && missingMedia.length === 0 ? "ready" : "not_ready",
    database: missingDatabasePrivileges.length === 0 ? "ready" : "not_ready",
    missingDatabasePrivileges,
    workers,
    media: {
      status: missingMedia.length === 0 ? "ready" : "not_ready",
      provider: mediaWriteProvider,
      blockers,
    },
    missingWorkers,
    missingMedia,
  };
}
