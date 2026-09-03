"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bot, CheckCircle2, Clock, ExternalLink, ShieldAlert, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { cn, formatDate } from "@/lib/utils";
import { NOTIFICATION_INBOX_CHANGED_EVENT } from "@/lib/notifications/inbox-count";
import { OrderDetailLink } from "@/components/order-detail-link";
import type { AuditSource, AuditStatus } from "@/lib/audit";
import {
  activityActionKey, activityEntity, activityObject, activityPrompt,
  activityRecordHref, activityRecordLabel, activityRelatedRecords, activityText,
  type NotificationActivity,
} from "@/lib/audit/activity-presentation";
import { useLocale, useTranslations } from "next-intl";
import { activityChanges, activityFieldKinds, activityItems, type ActivityChange, type ActivityField } from "@/lib/audit/activity-details";

export type AuditRow = NotificationActivity;
type Translator = ReturnType<typeof useTranslations>;

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

function titleFor(row: AuditRow, t: Translator) {
  const key = `notifications.activity.actions.${activityActionKey(row.action)}`;
  if (t.has(key)) return t(key);
  const title = activityText(activityObject(row.parsedIntent).title);
  if (title && /\s/.test(title) && !title.includes("_")) return truncateText(title);
  const entityKey = `notifications.activity.entities.${row.entityType}`;
  return t("notifications.activity.fallbackTitle", {
    entity: t.has(entityKey) ? t(entityKey) : t("notifications.recordFallback"),
  });
}

function actorFor(row: AuditRow, t: Translator) {
  const metadata = activityObject(row.metadata);
  if (metadata.channel === "customer_portal") return activityText(metadata.customerName) ?? t("notifications.activity.customerActor");
  if (metadata.submittedByCustomer === true) return t("notifications.activity.customerActor");
  return row.actorNameSnapshot?.trim() || (row.source === "system"
    ? t("notifications.systemActor")
    : t("notifications.activity.unknownActor"));
}

function statusText(status: AuditStatus, t: Translator) {
  return t(`notifications.statuses.${status}`);
}

function sourceText(source: AuditSource, t: Translator) {
  return t(`notifications.sources.${source}`);
}


function valueFor(key: ActivityField, value: unknown, t: Translator, locale: string): string {
  if (value === null || value === undefined || value === "") return t("notifications.activity.emptyValue");
  const kind = activityFieldKinds[key];
  if (kind === "boolean" && typeof value === "boolean") return t(`notifications.activity.values.${value ? "yes" : "no"}`);
  if ((kind === "number" || kind === "money") && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat(locale, kind === "money"
      ? { style: "currency", currency: "VND", maximumFractionDigits: 0 }
      : { maximumFractionDigits: 4 }).format(Number(value));
  }
  if (kind === "collection" && Array.isArray(value)) return t("notifications.activity.itemCount", { count: value.length });
  if (kind === "date" && typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...(value.includes("T") ? { timeStyle: "short" as const } : {}) }).format(new Date(value));
  }
  if (kind === "enum" && typeof value === "string") {
    const path = `notifications.activity.values.${value.replaceAll(".", "_")}`;
    return t.has(path) ? t(path) : t("notifications.activity.updatedValue");
  }
  if (typeof value !== "string" && typeof value !== "number") return t("notifications.activity.updatedValue");
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value))) return t("notifications.activity.updatedValue");
  return truncateText(String(value), 600);
}

function changeText(change: ActivityChange, t: Translator, locale: string) {
  const label = t(`notifications.activity.fields.${change.key}`);
  const before = valueFor(change.key, change.before, t, locale);
  const after = valueFor(change.key, change.after, t, locale);
  return `${label}: ${change.hasBefore && change.hasAfter ? `${before} → ${after}` : change.hasAfter ? after : before}`;
}

function ActivityChanges({ row }: { row: AuditRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const changes = activityChanges(row).filter((change) => !["items", "replacementItems"].includes(change.key));
  const fields = activityObject(row.metadata).changedFields;
  const changedFields = Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : [];
  const changedLabels = changedFields.flatMap((field) => {
    const path = `notifications.activity.fields.${field}`;
    return t.has(path) ? [t(path)] : [];
  });
  return <>
    {changes.length > 0 && <section>
      <h3 className="mb-3 font-semibold">{t("notifications.activity.changes")}</h3>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-xs text-slate-500"><tr>
            <th className="p-3 font-medium" scope="col">{t("notifications.activity.field")}</th>
            <th className="p-3 font-medium" scope="col">{t("notifications.activity.before")}</th>
            <th className="p-3 font-medium" scope="col">{t("notifications.activity.after")}</th>
          </tr></thead>
          <tbody>{changes.map((change) => <tr className="border-t border-border" key={change.key}>
            <th scope="row" className="w-1/3 p-3 align-top font-medium">{t(`notifications.activity.fields.${change.key}`)}</th>
            <td className="max-w-56 break-words p-3 align-top text-slate-500">{valueFor(change.key, change.before, t, locale)}</td>
            <td className="max-w-56 break-words p-3 align-top font-medium">{valueFor(change.key, change.after, t, locale)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}
    {changedFields.length > 0 && <p className="text-slate-600">{t("notifications.activity.settingsChanged", { count: changedFields.length })}{changedLabels.length > 0 && ` ${changedLabels.join(", ")}.`}</p>}
    {(["items", "replacementItems"] as const).map((field) => {
      const items = activityItems(row, field);
      if (!items.length) return null;
      const showBefore = items.some((item) => item.beforeQuantity !== undefined);
      const showPrice = items.some((item) => item.unitPrice !== undefined);
      return <details key={field} open={items.length <= 8} className="rounded-xl border border-border">
        <summary className="cursor-pointer p-3 font-semibold">{t(`notifications.activity.fields.${field}`)} · {items.length}</summary>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="bg-canvas text-xs text-slate-500"><tr>
            <th scope="col" className="p-3 font-medium">{t("notifications.activity.product")}</th>
            {showBefore && <th scope="col" className="p-3 text-right font-medium">{t("notifications.activity.before")}</th>}
            <th scope="col" className="p-3 text-right font-medium">{t("notifications.activity.fields.quantity")}</th>
            {showPrice && <th scope="col" className="p-3 text-right font-medium">{t("notifications.activity.fields.unitPrice")}</th>}
          </tr></thead>
          <tbody>{items.map((item, index) => <tr key={index} className="border-t border-border">
            <th scope="row" className="p-3 font-medium">{truncateText(item.name)}{item.unit && <span className="ml-1 text-xs font-normal text-slate-500">({item.unit})</span>}</th>
            {showBefore && <td className="p-3 text-right text-slate-500">{valueFor("quantity", item.beforeQuantity, t, locale)}</td>}
            <td className="p-3 text-right">{valueFor("quantity", item.quantity, t, locale)}</td>
            {showPrice && <td className="p-3 text-right">{valueFor("unitPrice", item.unitPrice, t, locale)}</td>}
          </tr>)}</tbody>
        </table></div>
      </details>;
    })}
  </>;
}

export function NotificationsTable({ rows }: { rows: AuditRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<AuditRow>[] = [
    { key: "notification", label: t("notifications.inbox.tabs.activity"), required: true, render: (row) => <ActivityCell row={row} t={t} /> },
    { key: "source", label: t("notifications.columns.source"), defaultVisible: true, width: "100px", render: (row) => <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold", sourceTone(row.source))}>{sourceText(row.source, t)}</span> },
    { key: "status", label: t("notifications.columns.status"), defaultVisible: true, width: "130px", render: (row) => <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold", toneFor(row.status))}>{statusText(row.status, t)}</span> },
    { key: "actor", label: t("notifications.columns.actor"), defaultVisible: true, width: "160px", render: (row) => <span className="inline-flex items-start gap-1.5 whitespace-normal text-slate-600"><UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />{actorFor(row, t)}</span> },
    { key: "time", label: t("notifications.columns.time"), defaultVisible: true, width: "160px", render: (row) => <span className="text-slate-500">{formatDate(row.createdAt)}</span> },
  ];
  return (
    <DataTableShell
      tableId="notifications.audit"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="1080px"
      renderMobileRow={({ row, expanded, toggle }) => <NotificationMobileRow row={row} expanded={expanded} toggle={toggle} />}
      renderDetail={(row) => <ExpandedAudit row={row} />}
      detailTitle={(row) => titleFor(row, t)}
      detailSubtitle={() => t("notifications.activity.detailSubtitle")}
      detailSize="lg"
    />
  );
}

export function NotificationMobileRow({ row, expanded, toggle }: { row: AuditRow; expanded: boolean; toggle: () => void }) {
  const t = useTranslations();
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={toggle}
      className="min-h-11 w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
    >
      <ActivityCell row={row} t={t} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={cn("rounded-full px-2 py-1 text-xs font-bold", sourceTone(row.source))}>{sourceText(row.source, t)}</span>
        <span className={cn("rounded-full px-2 py-1 text-xs font-bold", toneFor(row.status))}>{statusText(row.status, t)}</span>
      </div>
      <div className="mt-2 text-xs text-slate-400">
        {actorFor(row, t)} · {formatDate(row.createdAt)}
      </div>
    </button>
  );
}

function ActivityCell({ row, t }: { row: AuditRow; t: Translator }) {
  const locale = useLocale();
  const summary = activityChanges(row).filter((change) => ["quantity", "amount", "amountPaid", "total", "currentDebt", "status"].includes(change.key)).slice(0, 2).map((change) => changeText(change, t, locale)).join(" · ");
  const entity = activityEntity(row);
  const prompt = activityPrompt(row.prompt);
  const related = activityRelatedRecords(row).map(activityRecordLabel).filter(Boolean).join(", ");
  const description = entity ? activityRecordLabel(entity) : related || prompt;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", toneFor(row.status))}>
        {iconFor(row.source, row.status)}
      </div>
      <div className="min-w-0">
        <div className="whitespace-normal font-semibold leading-5">{titleFor(row, t)}</div>
        {description && <div className="mt-1 line-clamp-2 whitespace-normal text-xs leading-5 text-slate-500">{truncateText(description)}</div>}
        {summary && <div className="mt-1 whitespace-normal text-xs font-medium text-slate-600">{summary}</div>}
        {entity?.context && <div className="mt-0.5 line-clamp-1 text-xs text-slate-400">{entity.context}</div>}
      </div>
    </div>
  );
}

function ExpandedAudit({ row }: { row: AuditRow }) {
  const t = useTranslations();
  const entity = activityEntity(row);
  const href = entity ? activityRecordHref(entity) : null;
  const records = activityRelatedRecords(row).filter((record) => activityRecordLabel(record) && record.id !== entity?.id);
  const metadata = activityObject(row.metadata);
  const serviceType = activityText(metadata.serviceType);
  const serviceKey = `notifications.activity.serviceTypes.${serviceType}`;
  const version = typeof metadata.version === "number" ? metadata.version : null;
  const prompt = activityPrompt(row.prompt);
  return (
    <div className="space-y-6 bg-surface text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-semibold", toneFor(row.status))}>
          {iconFor(row.source, row.status)}{statusText(row.status, t)}
        </span>
        <AcknowledgeNotificationButton id={row.id} />
      </div>
      <dl className="grid gap-4 border-b border-border pb-5 sm:grid-cols-3">
        {[
          [t("notifications.columns.actor"), actorFor(row, t)],
          [t("notifications.columns.source"), sourceText(row.source, t)],
          [t("notifications.columns.time"), formatDate(row.createdAt)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}
      </dl>
      {entity && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-500">{t("notifications.activity.subject")}</h3>
          <div className="text-base font-semibold">{activityRecordLabel(entity)}</div>
          {entity.context && <p className="text-slate-600">{t("notifications.activity.project")}: {entity.context}</p>}
          {href && <Link href={href} onClick={stopRowToggle} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 font-semibold text-white hover:bg-primary-700">
            {t(entity.type === "service_job" ? "notifications.activity.openProject" : "notifications.activity.openRecord")}<ExternalLink className="h-4 w-4" />
          </Link>}
        </section>
      )}
      {(serviceType || version !== null) && <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl bg-canvas p-4">
        {serviceType && t.has(serviceKey) && <div><dt className="text-xs text-slate-500">{t("notifications.activity.serviceType")}</dt><dd className="mt-1 font-medium">{t(serviceKey)}</dd></div>}
        {version !== null && <div><dt className="text-xs text-slate-500">{t("notifications.activity.version")}</dt><dd className="mt-1 font-medium">{t("notifications.activity.versionValue", { version })}</dd></div>}
      </dl>}
      <ActivityChanges row={row} />
      {prompt && <section><h3 className="mb-2 text-xs font-semibold text-slate-500">{t("notifications.prompt")}</h3><p className="whitespace-pre-wrap break-words leading-6 text-slate-600">{truncateText(prompt, 1400)}</p></section>}
      {!entity && !prompt && records.length === 0 && activityChanges(row).length === 0 && <p className="text-slate-500">{t("notifications.activity.noDescription")}</p>}
      {records.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{t("notifications.relatedRecords")}</div>
          <div className="flex flex-wrap gap-1.5">
            {records.slice(0, 10).map((record, index) => {
              const href = activityRecordHref(record);
              const label = activityRecordLabel(record);
              const recordId = record.id;
              const recordType = record.type;
              const chip = (
                <span className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-surface px-2 text-[11px] font-semibold text-slate-600">
                  {label}
                  {href && <ExternalLink className="h-3 w-3" />}
                </span>
              );
              if (recordId && ["order", "invoice", "quote"].includes(recordType ?? "")) {
                return (
                  <OrderDetailLink key={`${label}-${index}`} orderId={recordId} onClick={stopRowToggle} className="inline-flex min-h-11 min-w-11">
                    {chip}
                  </OrderDetailLink>
                );
              }
              return href ? <Link key={`${label}-${index}`} href={href} onClick={stopRowToggle} className="inline-flex min-h-11 min-w-11">{chip}</Link> : <span key={`${label}-${index}`}>{chip}</span>;
            })}
          </div>
        </div>
      )}
      <details className="border-t border-border pt-4">
        <summary className="w-fit cursor-pointer py-2 text-xs font-medium text-slate-500">{t("notifications.activity.technicalDetails")}</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-canvas p-3 text-[11px] leading-relaxed text-slate-600">
          {JSON.stringify(scrubPublicJson({ action: row.action, entityType: row.entityType, entityId: row.entityId, actorId: row.actorId, parsedIntent: row.parsedIntent, before: row.before, after: row.after, affectedRecords: row.affectedRecords, metadata: row.metadata }), null, 2)}
        </pre>
      </details>
    </div>
  );
}

function AcknowledgeNotificationButton({ id }: { id: string }) {
  const t = useTranslations();
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
          const response = await fetch(`/api/mobile/notifications/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ read: true, dismissed: true }),
          });
          if (response.ok) {
            window.dispatchEvent(new Event(NOTIFICATION_INBOX_CHANGED_EVENT));
          }
          router.refresh();
        });
      }}
      className="min-h-11 rounded-full text-xs font-bold text-slate-600"
    >
      {pending ? t("notifications.processing") : t("notifications.processed")}
    </Button>
  );
}
