import Link from "next/link";
import { Activity, Filter } from "lucide-react";
import { NotificationsTable } from "./notifications-table";
import { getAuditLogs, type AuditSource, type AuditStatus } from "@/lib/audit";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SOURCES: AuditSource[] = ["manual", "ai", "mobile", "pos", "system"];
const STATUSES: AuditStatus[] = ["previewed", "confirmed", "succeeded", "failed", "cancelled", "unauthorized"];

function validSource(value?: string): AuditSource | undefined {
  return SOURCES.includes(value as AuditSource) ? value as AuditSource : undefined;
}

function validStatus(value?: string): AuditStatus | undefined {
  return STATUSES.includes(value as AuditStatus) ? value as AuditStatus : undefined;
}

function paramsWith(current: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/notifications?${query}` : "/notifications";
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const source = validSource(params.source);
  const status = validStatus(params.status);
  const rows = await getAuditLogs({
    source,
    status,
    action: params.action,
    entityType: params.entityType,
    limit: 100,
  });

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-4 sm:px-6 pt-2.5 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary-600" />
          <div>
            <h1 className="text-[17px] font-bold leading-tight">Lịch sử hoạt động</h1>
            <p className="text-[11px] text-slate-400">Audit log cho thao tác thủ công, mobile, POS và AI</p>
          </div>
        </div>
        <div className="px-4 sm:px-6 pb-2 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-slate-500">
            <Filter className="w-3.5 h-3.5" /> Bộ lọc
          </span>
          <Link className={cn("px-2.5 py-1 rounded-full border text-xs font-medium", !source ? "bg-primary-50 border-primary-100 text-primary-700" : "border-border text-slate-500")} href={paramsWith(params, { source: undefined })}>Tất cả nguồn</Link>
          {SOURCES.map((item) => (
            <Link key={item} className={cn("px-2.5 py-1 rounded-full border text-xs font-medium capitalize", source === item ? "bg-primary-50 border-primary-100 text-primary-700" : "border-border text-slate-500")} href={paramsWith(params, { source: item })}>{item}</Link>
          ))}
          <Link className={cn("px-2.5 py-1 rounded-full border text-xs font-medium", !status ? "bg-surface-2 border-border text-slate-700" : "border-border text-slate-500")} href={paramsWith(params, { status: undefined })}>Tất cả trạng thái</Link>
          {STATUSES.map((item) => (
            <Link key={item} className={cn("px-2.5 py-1 rounded-full border text-xs font-medium", status === item ? "bg-surface-2 border-border text-slate-700" : "border-border text-slate-500")} href={paramsWith(params, { status: item })}>{item}</Link>
          ))}
        </div>
      </div>

      <NotificationsTable rows={rows} />
    </div>
  );
}
