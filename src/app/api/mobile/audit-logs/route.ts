import { getAuditLogs, type AuditSource, type AuditStatus } from "@/lib/audit";
import {
  MOBILE_AUDIT_ROLES,
  toMobileAuditLog,
} from "@/lib/audit/mobile-audit";
import { requireMobileRole } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, numberParam, searchParam } from "@/lib/mobile/response";

const SOURCES = new Set(["manual", "ai", "mobile", "pos", "system"]);
const STATUSES = new Set(["previewed", "confirmed", "succeeded", "failed", "cancelled", "unauthorized"]);

function dateParam(request: Request, key: string) {
  const raw = searchParam(request, key);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  const gate = await requireMobileRole(MOBILE_AUDIT_ROLES);
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const source = searchParam(request, "source");
  const status = searchParam(request, "status");
  const rows = await getAuditLogs({
    source: source && SOURCES.has(source) ? source as AuditSource : undefined,
    status: status && STATUSES.has(status) ? status as AuditStatus : undefined,
    action: searchParam(request, "action"),
    entityType: searchParam(request, "entityType"),
    actorId: searchParam(request, "actorId"),
    dateFrom: dateParam(request, "dateFrom"),
    dateTo: dateParam(request, "dateTo"),
    limit: numberParam(request, "limit", 100),
  });

  return mobileOk({
    rows: rows.map(toMobileAuditLog),
  });
}
