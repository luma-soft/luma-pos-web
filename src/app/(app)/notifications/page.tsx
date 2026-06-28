import Link from "next/link";
import { Activity, Bot, CheckCircle2, Clock, ExternalLink, Filter, Info, ShieldAlert, UserRound, XCircle } from "lucide-react";
import { getAuditLogs, type AuditSource, type AuditStatus } from "@/lib/audit";
import { cn, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SOURCES: AuditSource[] = ["manual", "ai", "mobile", "pos", "system"];
const STATUSES: AuditStatus[] = ["previewed", "confirmed", "succeeded", "failed", "cancelled", "unauthorized"];

function validSource(value?: string): AuditSource | undefined {
  return SOURCES.includes(value as AuditSource) ? value as AuditSource : undefined;
}

function validStatus(value?: string): AuditStatus | undefined {
  return STATUSES.includes(value as AuditStatus) ? value as AuditStatus : undefined;
}

function iconFor(source: AuditSource, status: AuditStatus) {
  if (status === "failed" || status === "unauthorized") return ShieldAlert;
  if (status === "cancelled") return XCircle;
  if (status === "previewed" || status === "confirmed") return Clock;
  if (source === "ai") return Bot;
  return CheckCircle2;
}

function toneFor(status: AuditStatus) {
  return status === "succeeded"
    ? "bg-ok-soft text-ok"
    : status === "failed" || status === "unauthorized"
      ? "bg-er-soft text-er"
      : status === "cancelled"
        ? "bg-surface-2 text-slate-500"
        : "bg-warn-soft text-warn";
}

function sourceTone(source: AuditSource) {
  return source === "ai"
    ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"
    : source === "mobile"
      ? "bg-in-soft text-in"
      : source === "pos"
        ? "bg-ok-soft text-ok"
        : "bg-surface-2 text-slate-500";
}

function titleFor(row: Awaited<ReturnType<typeof getAuditLogs>>[number]) {
  return `${row.action.replaceAll("_", " ")} · ${row.entityType}`;
}

type AuditRow = Awaited<ReturnType<typeof getAuditLogs>>[number];

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function redactText(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]")
    .replace(/AIza[A-Za-z0-9_-]{12,}/g, "AIza[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'",\s}]+/gi, "$1: [redacted]");
}

function truncateText(value: string, max = 220) {
  const clean = redactText(value.replace(/\s+/g, " ").trim());
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function scrubPublicJson(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return truncateText(value, depth === 0 ? 260 : 160);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => scrubPublicJson(item, depth + 1));

  const hiddenKeys = /^(raw(content|text)?|content|base64|dataUrl|ocrText|extractedText|image|file)$/i;
  const sensitiveKeys = /(api[_-]?key|token|secret|password|authorization)/i;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 24)) {
    if (sensitiveKeys.test(key)) {
      output[key] = "[redacted]";
    } else if (hiddenKeys.test(key)) {
      output[key] = "[hidden in activity view]";
    } else {
      output[key] = scrubPublicJson(item, depth + 1);
    }
  }
  return output;
}

function intentLabel(row: AuditRow) {
  const parsed = objectValue(row.parsedIntent);
  return textValue(parsed?.intent) ?? textValue(parsed?.mode) ?? row.action;
}

function previewTitle(row: AuditRow) {
  const parsed = objectValue(row.parsedIntent);
  return textValue(parsed?.title) ?? textValue(parsed?.description);
}

function statusText(status: AuditStatus) {
  switch (status) {
    case "previewed": return "Đã tạo preview";
    case "confirmed": return "Đã xác nhận";
    case "succeeded": return "Thành công";
    case "failed": return "Thất bại";
    case "cancelled": return "Đã hủy";
    case "unauthorized": return "Không đủ quyền";
    default: return status;
  }
}

function recordHref(record: Record<string, unknown>) {
  const href = textValue(record.href);
  if (href?.startsWith("/")) return href;
  const id = textValue(record.id);
  const type = textValue(record.type);
  if (!id || id === "draft") return null;
  if (type === "product") return `/products/${id}`;
  if (type === "customer") return `/customers/${id}`;
  if (type === "order" || type === "invoice" || type === "quote") return `/orders/${id}`;
  if (type === "purchase_order" || type === "purchase" || type === "inbound") return `/purchases/${id}`;
  if (type === "supplier") return `/suppliers/${id}`;
  if (type === "pos_cart_draft") return "/pos";
  if (type === "cashbook" || type === "cash_transaction") return "/cashbook";
  return null;
}

function recordLabel(record: Record<string, unknown>) {
  return textValue(record.code)
    ?? textValue(record.name)
    ?? textValue(record.label)
    ?? textValue(record.id)
    ?? textValue(record.type)
    ?? "Record";
}

function AiAuditSummary({ row }: { row: AuditRow }) {
  const parsed = objectValue(row.parsedIntent);
  const metadata = objectValue(row.metadata);
  const records = arrayValue(row.affectedRecords).map(objectValue).filter(Boolean) as Record<string, unknown>[];
  const toolTrace = arrayValue(metadata?.toolTrace).map(objectValue).filter(Boolean) as Record<string, unknown>[];
  const warnings = arrayValue(parsed?.warnings);
  const fields = [
    ["Intent", intentLabel(row)],
    ["Preview", previewTitle(row)],
    ["Surface", textValue(metadata?.surface)],
    ["Tool", textValue(metadata?.executedTool)],
    ["Usage", typeof metadata?.usageUnits === "number" ? `${metadata.usageUnits} unit` : null],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="mt-2 space-y-2 text-xs">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border-soft bg-canvas px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{label}</div>
            <div className="mt-0.5 text-slate-700">{truncateText(String(value), 90)}</div>
          </div>
        ))}
      </div>

      {records.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {records.slice(0, 8).map((record, index) => {
            const href = recordHref(record);
            const label = recordLabel(record);
            const chip = (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {label}
                {href && <ExternalLink className="w-3 h-3" />}
              </span>
            );
            return href ? <Link key={`${label}-${index}`} href={href}>{chip}</Link> : <span key={`${label}-${index}`}>{chip}</span>;
          })}
        </div>
      )}

      {toolTrace.length > 0 && (
        <div className="rounded-lg border border-primary-100 bg-primary-50/50 p-2 dark:border-primary-900 dark:bg-primary-950/20">
          <div className="text-[10px] uppercase tracking-wide text-primary-700 font-bold dark:text-primary-300">Tool trace</div>
          <div className="mt-1 space-y-1">
            {toolTrace.slice(0, 4).map((tool, index) => (
              (() => {
                const resultIntent = textValue(objectValue(tool.result)?.intent);
                return (
                  <div key={index} className="flex flex-wrap items-center gap-1.5 text-slate-600">
                    <span className="font-semibold">{textValue(tool.tool) ?? "tool"}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", tool.status === "failed" ? "bg-er-soft text-er" : "bg-ok-soft text-ok")}>
                      {textValue(tool.status) ?? "succeeded"}
                    </span>
                    {typeof tool.durationMs === "number" && <span>{tool.durationMs}ms</span>}
                    {resultIntent && <span>→ {resultIntent}</span>}
                  </div>
                );
              })()
            ))}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg bg-warn-soft px-2.5 py-2 text-warn">
          {truncateText(String(warnings[0]), 160)}
        </div>
      )}
    </div>
  );
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

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Info className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">Chưa có hoạt động phù hợp.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-card shadow-e1 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-220 text-sm">
              <thead>
                <tr className="bg-canvas text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-border">
                  <th className="px-4 py-2.5 font-bold">Hoạt động</th>
                  <th className="px-4 py-2.5 font-bold">Nguồn</th>
                  <th className="px-4 py-2.5 font-bold">Trạng thái</th>
                  <th className="px-4 py-2.5 font-bold">Người thực hiện</th>
                  <th className="px-4 py-2.5 font-bold">Thời gian</th>
                  <th className="px-4 py-2.5 font-bold">Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const Icon = iconFor(row.source, row.status);
                  return (
                    <tr key={row.id} className="border-b border-border-soft last:border-0 align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className={cn("w-9 h-9 rounded-xl grid place-items-center shrink-0", toneFor(row.status))}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold capitalize">{row.source === "ai" ? statusText(row.status) : titleFor(row)}</div>
                            <div className="text-xs text-slate-400 font-mono mt-0.5">{row.entityId ?? "—"}</div>
                            {row.prompt && <div className="text-xs text-slate-500 mt-1 line-clamp-2">Prompt: {truncateText(row.prompt)}</div>}
                            {row.source === "ai" && <AiAuditSummary row={row} />}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize", sourceTone(row.source))}>{row.source}</span></td>
                      <td className="px-4 py-3"><span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold", toneFor(row.status))}>{row.status}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <UserRound className="w-3.5 h-3.5" />
                          <span>{row.actorNameSnapshot ?? row.actorId ?? "System"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatDate(row.createdAt)}</td>
                      <td className="px-4 py-3 max-w-96">
                        <details className="text-xs">
                          <summary className="cursor-pointer font-semibold text-primary-600">Xem metadata</summary>
                          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-canvas p-3 text-[11px] leading-relaxed text-slate-600">{JSON.stringify(scrubPublicJson({
                            parsedIntent: row.parsedIntent,
                            before: row.before,
                            after: row.after,
                            affectedRecords: row.affectedRecords,
                            metadata: row.metadata,
                          }), null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
