import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { authSessions, profiles } from "@/db/schema";
import { authProvider } from "@/lib/auth/provider";
import { MANAGER_ROLES } from "@/lib/auth/roles";
import { requireStoreRole } from "@/lib/auth/store-context";
import { recordActivity } from "@/lib/audit/activity-log";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  if (authProvider() !== "lumapos") {
    return NextResponse.json({ ok: false, error: "AUTH_PROVIDER_NOT_READY" }, { status: 503 });
  }
  try {
    const actor = await requireStoreRole(MANAGER_ROLES);
    const { profileId } = await context.params;
    const [target] = await db.select({ id: profiles.id, role: profiles.role })
      .from(profiles)
      .where(and(eq(profiles.id, profileId), eq(profiles.storeId, actor.storeId)))
      .limit(1);
    if (!target) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (target.id === actor.userId || (actor.role === "manager" && target.role === "owner")) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    const now = new Date();
    const revoked = await db.transaction(async (tx) => {
      const rows = await tx.update(authSessions).set({ revokedAt: now, revokedBy: actor.userId })
        .where(and(
          eq(authSessions.storeId, actor.storeId),
          eq(authSessions.profileId, profileId),
          isNull(authSessions.revokedAt),
        )).returning({ id: authSessions.id });
      await recordActivity(tx, {
        storeId: actor.storeId,
        actorId: actor.userId,
        action: "admin.staff_sessions_revoked",
        entityType: "profile",
        entityId: profileId,
        after: { revokedCount: rows.length },
      });
      return rows.length;
    });
    return NextResponse.json({ ok: true, data: { revoked } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    console.error("admin session revocation failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
