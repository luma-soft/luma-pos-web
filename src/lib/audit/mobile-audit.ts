import type { Role } from "@/lib/actions/common";
import type { NotificationActivity } from "@/lib/audit/activity-presentation";

export const MOBILE_AUDIT_ROLES = [
  "owner",
  "manager",
] as const satisfies readonly Role[];

export function canReadMobileAuditLog(role: Role) {
  return MOBILE_AUDIT_ROLES.some((allowedRole) => allowedRole === role);
}

export function toMobileAuditLog(row: NotificationActivity) {
  return {
    id: row.id,
    actorNameSnapshot: row.actorNameSnapshot,
    source: row.source,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    status: row.status,
    prompt: row.prompt,
    parsedIntent: row.parsedIntent,
    before: row.before,
    after: row.after,
    affectedRecords: row.affectedRecords,
    metadata: row.metadata,
    resolvedEntity: row.resolvedEntity ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
