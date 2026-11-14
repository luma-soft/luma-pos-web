import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { databaseBackupRuns, syncEvents } from "@/db/schema";
import { authProvider } from "@/lib/auth/provider";
import { OWNER_ROLES } from "@/lib/auth/roles";
import { requireStoreRole } from "@/lib/auth/store-context";
import { readSelfHostedReadiness } from "@/lib/ops/self-hosted-readiness";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function unavailable() {
  return json({ ok: false, error: "AUTH_PROVIDER_NOT_READY" }, 503);
}

export async function GET() {
  if (authProvider() !== "lumapos") return unavailable();
  try {
    const context = await requireStoreRole(OWNER_ROLES);
    const [readiness, queueRows, backups] = await Promise.all([
      readSelfHostedReadiness(),
      db.select({ status: syncEvents.status, count: sql<number>`count(*)::int` })
        .from(syncEvents)
        .where(eq(syncEvents.storeId, context.storeId))
        .groupBy(syncEvents.status),
      db.select({
        id: databaseBackupRuns.id,
        status: databaseBackupRuns.status,
        triggerType: databaseBackupRuns.triggerType,
        requestedAt: databaseBackupRuns.requestedAt,
        startedAt: databaseBackupRuns.startedAt,
        finishedAt: databaseBackupRuns.finishedAt,
        archiveKey: databaseBackupRuns.archiveKey,
        archiveSizeBytes: databaseBackupRuns.archiveSizeBytes,
        sha256: databaseBackupRuns.sha256,
        failureCode: databaseBackupRuns.failureCode,
      }).from(databaseBackupRuns).orderBy(desc(databaseBackupRuns.requestedAt)).limit(10),
    ]);
    return json({
      ok: true,
      data: {
        backend: { status: "online", uptimeSeconds: Math.floor(process.uptime()) },
        readiness: {
          status: readiness.status,
          missingDatabasePrivileges: readiness.missingDatabasePrivileges,
          missingWorkers: readiness.missingWorkers,
          backup: readiness.backup,
          missingBackup: readiness.missingBackup,
          missingMedia: readiness.missingMedia,
        },
        database: {
          status: readiness.database,
          blockers: readiness.missingDatabasePrivileges,
        },
        media: readiness.media,
        sync: {
          worker: readiness.workers["sync-inbox"] ?? { status: "offline", lastSeenAt: null },
          queue: Object.fromEntries(queueRows.map((row) => [row.status, row.count])),
        },
        workers: {
          notifications: readiness.workers["notification-outbox"] ?? { status: "offline", lastSeenAt: null },
          backups: readiness.workers["database-backup"] ?? { status: "offline", lastSeenAt: null },
        },
        backups: backups.map((run) => ({
          ...run,
          archiveSizeBytes: run.archiveSizeBytes === null ? null : Number(run.archiveSizeBytes),
          requestedAt: run.requestedAt.toISOString(),
          startedAt: run.startedAt?.toISOString() ?? null,
          finishedAt: run.finishedAt?.toISOString() ?? null,
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ ok: false, error: "FORBIDDEN" }, 403);
    console.error("admin operations status failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function POST() {
  if (authProvider() !== "lumapos") return unavailable();
  try {
    const context = await requireStoreRole(OWNER_ROLES);
    const [run] = await db.insert(databaseBackupRuns).values({
      triggerType: "manual",
      status: "queued",
      requestedByUserId: context.userId,
      requestedByStoreId: context.storeId,
    }).returning({ id: databaseBackupRuns.id });
    return json({ ok: true, data: run }, 202);
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
    if (code === "23505") return json({ ok: false, error: "BACKUP_ALREADY_RUNNING" }, 409);
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ ok: false, error: "FORBIDDEN" }, 403);
    console.error("manual database backup request failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}
