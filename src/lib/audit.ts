import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, profiles } from "@/db/schema";
import { getProfileId } from "@/lib/actions/common";
import { sanitizeActivityValue } from "@/lib/audit/activity-log";

export type AuditSource = "manual" | "ai" | "mobile" | "pos" | "system";
export type AuditStatus =
  | "previewed"
  | "confirmed"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unauthorized";

type Jsonish = Record<string, unknown> | unknown[] | null;

export type AuditLogInput = {
  storeId?: string;
  actorUserId?: string | null;
  actorId?: string | null;
  source: AuditSource;
  action: string;
  entityType: string;
  entityId?: string | null;
  status?: AuditStatus;
  prompt?: string | null;
  parsedIntent?: Jsonish;
  before?: Jsonish;
  after?: Jsonish;
  affectedRecords?: Record<string, unknown>[] | null;
  metadata?: Record<string, unknown> | null;
};

async function actorSnapshot(actorId: string | null) {
  if (!actorId) return { actorId: null, actorNameSnapshot: null, storeId: null };
  const [profile] = await db
    .select({ id: profiles.id, fullName: profiles.fullName, storeId: profiles.storeId })
    .from(profiles)
    .where(eq(profiles.id, actorId))
    .limit(1);
  return {
    actorId: profile?.id ?? null,
    actorNameSnapshot: profile?.fullName ?? null,
    storeId: profile?.storeId ?? null,
  };
}

export async function writeAuditLog(input: AuditLogInput) {
  try {
    const actorId =
      input.actorId ??
      (input.actorUserId ? await getProfileId(input.actorUserId) : null);
    const actor = await actorSnapshot(actorId);
    const storeId = input.storeId ?? actor.storeId;
    if (!storeId) throw new Error("ACTIVITY_STORE_REQUIRED");
    if (actor.storeId && actor.storeId !== storeId) throw new Error("ACTIVITY_ACTOR_STORE_MISMATCH");
    await db.insert(auditLogs).values({
      storeId,
      actorId: actor.actorId,
      actorNameSnapshot: actor.actorNameSnapshot,
      source: input.source,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      status: input.status ?? "succeeded",
      prompt: input.prompt ?? null,
      parsedIntent: input.parsedIntent ?? null,
      before: sanitizeActivityValue(input.before ?? null) as Jsonish,
      after: sanitizeActivityValue(input.after ?? null) as Jsonish,
      affectedRecords: sanitizeActivityValue(input.affectedRecords ?? null) as Record<string, unknown>[] | null,
      metadata: sanitizeActivityValue(input.metadata ?? null) as Record<string, unknown> | null,
    });
  } catch (e) {
    console.error("writeAuditLog failed:", e);
  }
}

export type AuditLogFilters = {
  storeId?: string;
  source?: AuditSource;
  status?: AuditStatus;
  action?: string;
  entityType?: string;
  actorId?: string;
  notificationUserId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
};

export async function getAuditLogs(filters: AuditLogFilters = {}) {
  const where: SQL[] = [];
  if (filters.storeId) where.push(eq(auditLogs.storeId, filters.storeId));
  if (filters.source) where.push(eq(auditLogs.source, filters.source));
  if (filters.status) where.push(eq(auditLogs.status, filters.status));
  if (filters.action) where.push(eq(auditLogs.action, filters.action));
  if (filters.entityType) where.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.actorId) where.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.notificationUserId) {
    where.push(sql`not exists (
      select 1
      from mobile_notification_states state
      where state.user_id = ${filters.notificationUserId}
        and state.notification_id = ${auditLogs.id}::text
        and state.dismissed = true
    )`);
  }
  if (filters.dateFrom) where.push(gte(auditLogs.createdAt, filters.dateFrom));
  if (filters.dateTo) where.push(lte(auditLogs.createdAt, filters.dateTo));

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 250);
  return db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actorNameSnapshot: auditLogs.actorNameSnapshot,
      source: auditLogs.source,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      status: auditLogs.status,
      prompt: auditLogs.prompt,
      parsedIntent: auditLogs.parsedIntent,
      before: auditLogs.before,
      after: auditLogs.after,
      affectedRecords: auditLogs.affectedRecords,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function getAttentionNotificationCount(userId?: string | null) {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(sql`
      ${userId ? sql`not exists (
        select 1
        from mobile_notification_states state
        where state.user_id = ${userId}
          and state.notification_id = ${auditLogs.id}::text
          and state.dismissed = true
      )` : sql`true`}
      and (
        ${auditLogs.status} in ('failed', 'unauthorized')
        or (
          ${auditLogs.status} = 'previewed'
          and coalesce(${auditLogs.parsedIntent}->>'id', '') <> ''
          and not exists (
            select 1
            from audit_logs followup
            where followup.created_at >= ${auditLogs.createdAt}
              and followup.status in ('confirmed', 'succeeded', 'cancelled')
              and followup.parsed_intent->>'id' = ${auditLogs.parsedIntent}->>'id'
          )
        )
      )
    `);

  return row?.value ?? 0;
}
