import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { auditLogs, profiles } from "@/db/schema";
import type { AuditSource, AuditStatus } from "@/lib/audit";

export type ActivityDatabase = Pick<typeof db, "select" | "insert">;
export type ActivityInput = {
  storeId: string;
  actorId: string | null;
  source?: AuditSource;
  action: string;
  entityType: string;
  entityId?: string | null;
  status?: AuditStatus;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  affectedRecords?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
};

const sensitiveKey = /password|secret|token|authorization|cookie|credential|private.?key|api.?key|cashier.?pin|pin.?hash|^pin$/i;

export function sanitizeActivityValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.slice(0, 2000);
  if (depth >= 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeActivityValue(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [
    key, sensitiveKey.test(key) ? "[redacted]" : sanitizeActivityValue(item, depth + 1),
  ]));
}

/** Source is presentation metadata only; identity and tenancy must come from the caller's gate. */
export async function requestActivitySource(): Promise<AuditSource> {
  try {
    const { headers } = await import("next/headers");
    const requestHeaders = await headers();
    if (requestHeaders.get("authorization")?.startsWith("Bearer ")) return "mobile";
    const referer = requestHeaders.get("referer");
    if (referer && new URL(referer).pathname === "/pos") return "pos";
  } catch {
    // Scripts and transaction verification can run outside an HTTP request.
  }
  return "manual";
}

/** Await inside the business transaction: rollback and idempotency then cover the activity too. */
export async function recordActivity(database: ActivityDatabase, input: ActivityInput) {
  const [actor] = input.actorId ? await database.select({ name: profiles.fullName })
    .from(profiles)
    .where(and(eq(profiles.storeId, input.storeId), eq(profiles.id, input.actorId)))
    .limit(1) : [];
  if (input.actorId && !actor) throw new Error("ACTIVITY_ACTOR_STORE_MISMATCH");
  await database.insert(auditLogs).values({
    storeId: input.storeId,
    actorId: input.actorId,
    actorNameSnapshot: actor?.name ?? null,
    source: input.source ?? await requestActivitySource(),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    status: input.status ?? "succeeded",
    before: sanitizeActivityValue(input.before ?? null) as Record<string, unknown> | null,
    after: sanitizeActivityValue(input.after ?? null) as Record<string, unknown> | null,
    affectedRecords: sanitizeActivityValue(input.affectedRecords ?? null) as Record<string, unknown>[] | null,
    metadata: sanitizeActivityValue(input.metadata ?? null) as Record<string, unknown> | null,
  });
}
