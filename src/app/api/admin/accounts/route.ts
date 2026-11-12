import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { authCredentials, authSessions, profiles } from "@/db/schema";
import { authProvider } from "@/lib/auth/provider";
import { hashPassword } from "@/lib/auth/password";
import { normalizePhone } from "@/lib/auth/phone";
import { MANAGER_ROLES, STAFF_ROLES, type Role } from "@/lib/auth/roles";
import { requireStoreRole } from "@/lib/auth/store-context";
import { recordActivity } from "@/lib/audit/activity-log";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return null;
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function validRole(value: unknown): value is Role {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

function unavailable() {
  return json({ ok: false, error: "AUTH_PROVIDER_NOT_READY" }, 503);
}

export async function GET() {
  if (authProvider() !== "lumapos") return unavailable();
  try {
    const context = await requireStoreRole(MANAGER_ROLES);
    const [rows, sessions] = await Promise.all([
      db.select({
        id: profiles.id,
        fullName: profiles.fullName,
        phone: profiles.phone,
        role: profiles.role,
        isActive: profiles.isActive,
        email: authCredentials.email,
        mustResetPassword: authCredentials.mustResetPassword,
      }).from(profiles)
        .leftJoin(authCredentials, eq(authCredentials.profileId, profiles.id))
        .where(eq(profiles.storeId, context.storeId))
        .orderBy(profiles.fullName),
      db.select({
        profileId: authSessions.profileId,
        count: sql<number>`count(*)::int`,
      }).from(authSessions)
        .where(and(
          eq(authSessions.storeId, context.storeId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        )).groupBy(authSessions.profileId),
    ]);
    const sessionCount = new Map(sessions.map((row) => [row.profileId, row.count]));
    return json({
      ok: true,
      data: rows.map((row) => ({
        ...row,
        activeSessions: sessionCount.get(row.id) ?? 0,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ ok: false, error: "FORBIDDEN" }, 403);
    console.error("admin account listing failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function POST(request: Request) {
  if (authProvider() !== "lumapos") return unavailable();
  const body = await readBody(request);
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role;
  const phoneNormalized = phone ? normalizePhone(phone) : null;
  if (!body || fullName.length < 2 || fullName.length > 120 ||
    (!email && !phone) || (email && !/^\S+@\S+\.\S+$/.test(email)) ||
    (phone && !phoneNormalized) || !validRole(role) || !password) {
    return json({ ok: false, error: "INVALID_DATA" }, 400);
  }

  try {
    const context = await requireStoreRole(MANAGER_ROLES);
    if (context.role === "manager" && role === "owner") return json({ ok: false, error: "FORBIDDEN" }, 403);
    const encoded = await hashPassword(password);
    const profileId = randomUUID();
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(profiles).values({
        id: profileId,
        storeId: context.storeId,
        fullName,
        phone: phone || null,
        phoneNormalized,
        role,
        isActive: true,
      });
      await tx.insert(authCredentials).values({
        profileId,
        email: email || null,
        emailNormalized: email ? email.toLowerCase() : null,
        passwordHash: encoded.hash,
        passwordHashType: encoded.type,
        emailVerifiedAt: email ? now : null,
        mustResetPassword: false,
        passwordChangedAt: now,
        updatedAt: now,
      });
      await recordActivity(tx, {
        storeId: context.storeId,
        actorId: context.userId,
        action: "admin.staff_account_created",
        entityType: "profile",
        entityId: profileId,
        after: { fullName, role, active: true, hasEmail: Boolean(email), hasPhone: Boolean(phone) },
      });
    });
    return json({ ok: true, data: { id: profileId } }, 201);
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
    if (code === "23505") return json({ ok: false, error: "ACCOUNT_ALREADY_EXISTS" }, 409);
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ ok: false, error: "FORBIDDEN" }, 403);
    console.error("admin account creation failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function PATCH(request: Request) {
  if (authProvider() !== "lumapos") return unavailable();
  const body = await readBody(request);
  const profileId = typeof body?.id === "string" ? body.id : "";
  const role = body?.role;
  const isActive = body?.isActive;
  const password = typeof body?.password === "string" ? body.password : undefined;
  if (!body || !/^[0-9a-f-]{36}$/i.test(profileId) ||
    (role !== undefined && !validRole(role)) ||
    (isActive !== undefined && typeof isActive !== "boolean") ||
    (password !== undefined && !password) ||
    (role === undefined && isActive === undefined && password === undefined)) {
    return json({ ok: false, error: "INVALID_DATA" }, 400);
  }

  try {
    const context = await requireStoreRole(MANAGER_ROLES);
    if (profileId === context.userId) return json({ ok: false, error: "SELF_CHANGE_NOT_ALLOWED" }, 409);
    if (password !== undefined && context.role !== "owner") return json({ ok: false, error: "FORBIDDEN" }, 403);
    const encoded = password === undefined ? null : await hashPassword(password);
    const now = new Date();
    const outcome = await db.transaction(async (tx) => {
      const activeOwners = await tx.select({ id: profiles.id }).from(profiles)
        .where(and(
          eq(profiles.storeId, context.storeId),
          eq(profiles.role, "owner"),
          eq(profiles.isActive, true),
        )).orderBy(profiles.id).for("update");
      const [target] = await tx.select({
        id: profiles.id,
        fullName: profiles.fullName,
        role: profiles.role,
        isActive: profiles.isActive,
      }).from(profiles).where(and(
        eq(profiles.id, profileId),
        eq(profiles.storeId, context.storeId),
      )).limit(1).for("update");
      if (!target) return "not-found" as const;
      if (context.role === "manager" && target.role === "owner") return "forbidden" as const;
      if (role === "owner" && context.role !== "owner") return "forbidden" as const;

      const nextRole = role as Role | undefined;
      const demotesLastOwner = target.role === "owner" && target.isActive && activeOwners.length === 1
        && ((nextRole !== undefined && nextRole !== "owner") || isActive === false);
      if (demotesLastOwner) return "last-owner" as const;

      const nextActive = typeof isActive === "boolean" ? isActive : target.isActive;
      const nextRoleValue = nextRole ?? target.role;
      if (nextActive !== target.isActive || nextRoleValue !== target.role) {
        await tx.update(profiles).set({ isActive: nextActive, role: nextRoleValue })
          .where(and(eq(profiles.storeId, context.storeId), eq(profiles.id, profileId)));
      }
      if (encoded) {
        await tx.insert(authCredentials).values({
          profileId,
          passwordHash: encoded.hash,
          passwordHashType: encoded.type,
          mustResetPassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: authCredentials.profileId,
          set: {
            passwordHash: encoded.hash,
            passwordHashType: encoded.type,
            mustResetPassword: false,
            failedLoginAttempts: 0,
            lockedUntil: null,
            passwordChangedAt: now,
            updatedAt: now,
          },
        });
      }
      if (encoded || !nextActive || nextRoleValue !== target.role) {
        await tx.update(authSessions).set({ revokedAt: now })
          .where(and(
            eq(authSessions.storeId, context.storeId),
            eq(authSessions.profileId, profileId),
            isNull(authSessions.revokedAt),
          ));
      }
      await recordActivity(tx, {
        storeId: context.storeId,
        actorId: context.userId,
        action: encoded ? "admin.staff_password_reset" : "admin.staff_account_updated",
        entityType: "profile",
        entityId: profileId,
        before: { role: target.role, active: target.isActive },
        after: { role: nextRoleValue, active: nextActive, passwordReset: Boolean(encoded) },
      });
      return "updated" as const;
    });
    if (outcome === "not-found") return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (outcome === "forbidden") return json({ ok: false, error: "FORBIDDEN" }, 403);
    if (outcome === "last-owner") return json({ ok: false, error: "LAST_ACTIVE_OWNER" }, 409);
    return json({ ok: true, data: { id: profileId, signedOut: true } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return json({ ok: false, error: "FORBIDDEN" }, 403);
    console.error("admin account update failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}
