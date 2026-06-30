"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bot, CheckCircle2, Clock, ExternalLink, ShieldAlert, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn, formatDate } from "@/lib/utils";
import { Routes } from "@/lib/routes";
import type { AuditSource, AuditStatus, getAuditLogs } from "@/lib/audit";

type AuditRow = Awaited<ReturnType<typeof getAuditLogs>>[number];

function iconFor(source: AuditSource, status: AuditStatus) {
  if (status === "failed" || status === "unauthorized") return <ShieldAlert className="h-4 w-4" />;
  if (status === "cancelled") return <XCircle className="h-4 w-4" />;
  if (status === "previewed" || status === "confirmed") return <Clock className="h-4 w-4" />;
  if (source === "ai") return <Bot className="h-4 w-4" />;
  return <CheckCircle2 className="h-4 w-4" />;
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
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
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
    if (sensitiveKeys.test(key)) output[key] = "[redacted]";
    else if (hiddenKeys.test(key)) output[key] = "[hidden in activity view]";
    else output[key] = scrubPublicJson(item, depth + 1);
  }
  return output;
}

function titleFor(row: AuditRow) {
  return `${row.action.replaceAll("_", " ")} · ${row.entityType}`;
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
  if (type === "product") return `/inventory?tab=products&expanded=${id}`;
  if (type === "customer") return `/partners?tab=customers&expandedCustomer=${id}`;
  if (type === "quote") return Routes.salesOrder(id, "quote");
  if (type === "order" || type === "invoice") return Routes.salesOrder(id, "completed");
  if (type === "purchase_order" || type === "purchase" || type === "inbound") return `/inventory?tab=purchases&expanded=${id}`;
  if (type === "supplier") return `/partners?tab=suppliers&expanded=${id}`;
  if (type === "pos_cart_draft") return "/pos";
  if (type === "cashbook" || type === "cash_transaction") return "/finance?tab=cashbook";
  return null;
}

function recordLabel(record: Record<string, unknown>) {
  return textValue(record.code) ?? textValue(record.name) ?? textValue(record.label) ?? textValue(record.id) ?? textValue(record.type) ?? "Record";
}

export function NotificationsTable({ rows }: { rows: AuditRow[] }) {
  const columns: DataTableColumn<AuditRow>[] = [
    { key: "notification", label: "Thông báo", required: true, render: (row) => <ActivityCell row={row} /> },
    { key: "source", label: "Nguồn", defaultVisible: true, width: "120px", render: (row) => <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize", sourceTone(row.source))}>{row.source}</span> },
    { key: "status", label: "Trạng thái", defaultVisible: true, width: "130px", render: (row) => <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold", toneFor(row.status))}>{row.status}</span> },
    { key: "actor", label: "Người thực hiện", defaultVisible: true, render: (row) => <span className="inline-flex items-center gap-1.5 text-slate-600"><UserRound className="h-3.5 w-3.5" />{row.actorNameSnapshot ?? row.actorId ?? "System"}</span> },
    { key: "time", label: "Thời gian", defaultVisible: true, width: "160px", render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
  ];
  return (
    <DataTableShell
      tableId="notifications.audit"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1080px"
      renderExpanded={(row) => <ExpandedAudit row={row} />}
    />
  );
}

function ActivityCell({ row }: { row: AuditRow }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", toneFor(row.status))}>
        {iconFor(row.source, row.status)}
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold capitalize">{row.source === "ai" ? statusText(row.status) : titleFor(row)}</div>
        <div className="mt-0.5 truncate font-mono text-xs text-slate-400">{row.entityId ?? "—"}</div>
        {row.prompt && <div className="mt-1 line-clamp-2 text-xs text-slate-500">Prompt: {truncateText(row.prompt)}</div>}
      </div>
    </div>
  );
}

function ExpandedAudit({ row }: { row: AuditRow }) {
  const records = arrayValue(row.affectedRecords).map(objectValue).filter(Boolean) as Record<string, unknown>[];
  return (
    <div className="space-y-3 bg-surface px-4 py-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Chi tiết thông báo</div>
        <AcknowledgeNotificationButton id={row.id} />
      </div>
      {records.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Bản ghi liên quan</div>
          <div className="flex flex-wrap gap-1.5">
            {records.slice(0, 10).map((record, index) => {
              const href = recordHref(record);
              const label = recordLabel(record);
              const chip = (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {label}
                  {href && <ExternalLink className="h-3 w-3" />}
                </span>
              );
              return href ? <Link key={`${label}-${index}`} href={href} onClick={stopRowToggle}>{chip}</Link> : <span key={`${label}-${index}`}>{chip}</span>;
            })}
          </div>
        </div>
      )}
      <pre className="max-h-72 overflow-auto rounded-lg bg-canvas p-3 text-[11px] leading-relaxed text-slate-600">
        {JSON.stringify(scrubPublicJson({
          parsedIntent: row.parsedIntent,
          before: row.before,
          after: row.after,
          affectedRecords: row.affectedRecords,
          metadata: row.metadata,
        }), null, 2)}
      </pre>
    </div>
  );
}

function AcknowledgeNotificationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={(event) => {
        stopRowToggle(event);
        startTransition(async () => {
          await fetch(`/api/mobile/notifications/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ read: true, dismissed: true }),
          });
          router.refresh();
        });
      }}
      className="h-8 rounded-full text-xs font-bold text-slate-600"
    >
      {pending ? "Đang xử lý..." : "Đã xử lý"}
    </Button>
  );
}
