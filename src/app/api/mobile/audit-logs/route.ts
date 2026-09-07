import type { AuditSource, AuditStatus } from "@/lib/audit";
import { getNotificationActivityPage } from "@/lib/audit/notification-activities";
import { MOBILE_AUDIT_ROLES, toMobileAuditLog } from "@/lib/audit/mobile-audit";
import { requireMobileRole } from "@/lib/mobile/auth";
import {
  mobileGate,
  mobileOk,
  numberParam,
  searchParam,
} from "@/lib/mobile/response";

const SOURCES = new Set(["manual", "ai", "mobile", "pos", "system"]);
const STATUSES = new Set([
  "previewed",
  "confirmed",
  "succeeded",
  "failed",
  "cancelled",
  "unauthorized",
]);

function dateParam(request: Request, key: string) {
  const raw = searchParam(request, key);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  const gate = await requireMobileRole(MOBILE_AUDIT_ROLES);
  if (!gate.ok) return mobileGate(gate);

  const source = searchParam(request, "source");
  const status = searchParam(request, "status");
  const pageSize = Math.min(
    100,
    Math.max(1, numberParam(request, "limit", 30)),
  );
  const page = Math.max(1, numberParam(request, "page", 1));
  const result = await getNotificationActivityPage(
    gate.storeId,
    gate.userId,
    page,
    pageSize,
    {
      source:
        source && SOURCES.has(source) ? (source as AuditSource) : undefined,
      status:
        status && STATUSES.has(status) ? (status as AuditStatus) : undefined,
      action: searchParam(request, "action"),
      entityType: searchParam(request, "entityType"),
      actorId: searchParam(request, "actorId"),
      dateFrom: dateParam(request, "dateFrom"),
      dateTo: dateParam(request, "dateTo"),
    },
  );

  return mobileOk({
    ...result,
    rows: result.rows.map(toMobileAuditLog),
  });
}
