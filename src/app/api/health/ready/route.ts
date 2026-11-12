import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { inArray } from "drizzle-orm";
import { systemWorkerHeartbeats } from "@/db/schema";
import { authProvider } from "@/lib/auth/provider";

export const runtime = "nodejs";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    const selfHostedAuth = authProvider() === "lumapos";
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
    const ready = missingWorkers.length === 0;

    return NextResponse.json({
      status: ready ? "ready" : "not_ready",
      database: "ready",
      workers: workerStatuses,
      ...(missingWorkers.length > 0 ? { missingWorkers } : {}),
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
