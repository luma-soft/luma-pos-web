import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { inArray } from "drizzle-orm";
import { systemWorkerHeartbeats } from "@/db/schema";
import { authProvider } from "@/lib/auth/provider";
import { getMediaWriteProvider } from "@/lib/media/config";

export const runtime = "nodejs";

function resultRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    const selfHostedAuth = authProvider() === "lumapos";
    const mediaWriteProvider = selfHostedAuth ? getMediaWriteProvider() : null;
    const workers = selfHostedAuth
      ? await db.select({
        workerKey: systemWorkerHeartbeats.workerKey,
        state: systemWorkerHeartbeats.state,
        lastSeenAt: systemWorkerHeartbeats.lastSeenAt,
      }).from(systemWorkerHeartbeats).where(inArray(systemWorkerHeartbeats.workerKey, [
        "sync-inbox",
        "notification-outbox",
        "database-backup",
      ]))
      : [];
    const now = Date.now();
    const workerStatuses = Object.fromEntries(workers.map((worker) => [
      worker.workerKey,
      {
        status: worker.state === "running" && now - worker.lastSeenAt.getTime() < 45_000
          ? "online"
          : "offline",
        lastSeenAt: worker.lastSeenAt.toISOString(),
      },
    ]));
    const requiredWorkerKeys = selfHostedAuth
      ? ["sync-inbox", "notification-outbox", "database-backup"]
      : [];
    const missingWorkers = requiredWorkerKeys.filter((workerKey) =>
      workerStatuses[workerKey]?.status !== "online"
    );
    const mediaState = selfHostedAuth
      ? resultRows(await db.execute(sql`
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
      `))[0] ?? {}
      : {};
    const mediaBlockers = selfHostedAuth ? {
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
        unfinishedLocalMediaMigration:
          mediaState.unfinishedLocalMediaMigration === true,
      } : {}),
    } : {};
    const missingMedia = Object.entries(mediaBlockers)
      .filter(([, blocked]) => blocked)
      .map(([blocker]) => blocker);
    const ready = missingWorkers.length === 0 && missingMedia.length === 0;

    return NextResponse.json({
      status: ready ? "ready" : "not_ready",
      database: "ready",
      workers: workerStatuses,
      media: {
        status: missingMedia.length === 0 ? "ready" : "not_ready",
        provider: mediaWriteProvider,
        blockers: mediaBlockers,
      },
      ...(missingWorkers.length > 0 ? { missingWorkers } : {}),
      ...(missingMedia.length > 0 ? { missingMedia } : {}),
    }, {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ status: "not_ready" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
