import type { Role } from "@/lib/actions/common";
import type { AuditSource, AuditStatus } from "@/lib/audit";

export const MOBILE_AUDIT_ROLES = ["owner", "manager"] as const satisfies readonly Role[];

export function canReadMobileAuditLog(role: Role) {
  return MOBILE_AUDIT_ROLES.some((allowedRole) => allowedRole === role);
}

type MobileAuditSourceRow = {
  id: string;
  actorNameSnapshot: string | null;
  source: AuditSource;
  action: string;
  entityType: string;
  entityId: string | null;
  status: AuditStatus;
  createdAt: Date;
};

export function toMobileAuditLog(row: MobileAuditSourceRow) {
  return {
    id: row.id,
    actorNameSnapshot: row.actorNameSnapshot,
    source: row.source,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
