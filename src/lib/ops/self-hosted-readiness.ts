import "server-only";

import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { systemWorkerHeartbeats } from "@/db/schema";
import { authProvider } from "@/lib/auth/provider";
import { getMediaWriteProvider } from "@/lib/media/config";

type WorkerKey = "sync-inbox" | "notification-outbox" | "database-backup";
type WorkerStatus = { status: "online" | "offline"; lastSeenAt: string | null };

export type SelfHostedReadiness = {
  status: "ready" | "not_ready";
  database: "ready";
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

export async function readSelfHostedReadiness(): Promise<SelfHostedReadiness> {
  await db.execute(sql`select 1`);
  if (authProvider() !== "lumapos") {
    return {
      status: "ready",
      database: "ready",
      workers: {},
      media: { status: "not_required", provider: null, blockers: {} },
      missingWorkers: [],
      missingMedia: [],
    };
  }

  const mediaWriteProvider = getMediaWriteProvider();
  const workerKeys: WorkerKey[] = [
    "sync-inbox",
    "notification-outbox",
    "database-backup",
  ];
  const [workerRows, mediaRows] = await Promise.all([
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
    } : {}),
  };
  const missingMedia = Object.entries(blockers)
    .filter(([, blocked]) => blocked)
    .map(([blocker]) => blocker);

  return {
    status: missingWorkers.length === 0 && missingMedia.length === 0 ? "ready" : "not_ready",
    database: "ready",
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
