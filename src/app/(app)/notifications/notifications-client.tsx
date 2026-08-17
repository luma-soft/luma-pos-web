"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Box,
  ChevronRight,
  FileWarning,
  Filter,
  PackageCheck,
  RefreshCw,
  Settings,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Routes } from "@/lib/routes";
import { NOTIFICATION_INBOX_CHANGED_EVENT } from "@/lib/notifications/inbox-count";
import { NotificationsTable, type AuditRow } from "./notifications-table";
import { NotificationsFilterDrawer } from "./notifications-filter-drawer";
import {
  applyNotificationFilters,
  countActiveNotificationFilters,
  defaultNotificationFilters,
  isActionableNotification,
  notificationCategory,
  notificationCreatedAt,
  notificationLevel,
  type NotificationAction,
  type NotificationFilters,
  type NotificationRow,
  type NotificationTab,
} from "./notification-view-model";

type NotificationsPayload = {
  rows?: NotificationRow[];
  counts?: { all?: number; unread?: number };
};

function notificationHref(action?: NotificationAction) {
  if (action?.href && (/^https?:\/\//i.test(action.href) || action.href.startsWith("/"))) {
    return action.href;
  }
  const id = action?.id;
  return switchTarget(action?.target, id);
}

function switchTarget(target?: string, id?: string) {
  switch (target) {
    case "aiRestocking":
    case "restocking":
      return "/inventory?tab=restocking";
    case "inventory":
      return Routes.Inventory;
    case "purchases":
      return id ? Routes.purchase(id) : Routes.Purchases;
    case "invoices":
    case "einvoice":
      return id ? Routes.salesOrder(id) : `${Routes.Sales}?tab=orders`;
    case "customers":
    case "crm":
    case "debt":
      return id ? `/partners?tab=customers&expandedCustomer=${encodeURIComponent(id)}` : `${Routes.Partners}?tab=customers`;
    case "reports":
    case "sales":
      return Routes.Reports;
    case "shift":
      return "/finance?tab=shifts";
    case "paymentReconciliation":
      return "/finance?tab=payments";
    case "services":
      return id ? `${Routes.Services}?job=${encodeURIComponent(id)}` : Routes.Services;
    default:
      return null;
  }
}

function CategoryIcon({ category, className }: { category: string; className?: string }) {
  switch (notificationCategory(category)) {
    case "inventory":
      return <PackageCheck className={className} />;
    case "einvoice":
      return <FileWarning className={className} />;
    case "debt":
      return <UserRound className={className} />;
    case "sales":
      return <BarChart3 className={className} />;
    default:
      return <RefreshCw className={className} />;
  }
}

function actionLabel(action: NotificationAction | undefined, t: ReturnType<typeof useTranslations>) {
  if (action?.viLabel || action?.label) return action.viLabel ?? action.label!;
  switch (action?.target) {
    case "aiRestocking":
    case "restocking":
      return t("actions.restock");
    case "invoices":
    case "einvoice":
      return t("actions.retry");
    case "customers":
    case "crm":
    case "debt":
      return t("actions.customer");
    case "purchases":
      return t("actions.purchase");
    case "reports":
    case "sales":
      return t("actions.report");
    default:
      return t("actions.open");
  }
}

export function NotificationsClient({ activities }: { activities: AuditRow[] }) {
  const t = useTranslations("notifications.inbox");
  const router = useRouter();
  const [tab, setTab] = useState<NotificationTab>("action");
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<NotificationFilters>(defaultNotificationFilters);
  const [, startTransition] = useTransition();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/mobile/notifications?locale=vi", { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; data?: NotificationsPayload };
      if (!response.ok || !payload.ok || !Array.isArray(payload.data?.rows)) throw new Error("notifications_failed");
      setRows(payload.data.rows);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/mobile/notifications?locale=vi", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; data?: NotificationsPayload };
        if (!response.ok || !payload.ok || !Array.isArray(payload.data?.rows)) {
          throw new Error("notifications_failed");
        }
        if (active) setRows(payload.data.rows);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleRows = useMemo(
    () => applyNotificationFilters(rows, filters, tab),
    [filters, rows, tab],
  );
  const actionableRows = useMemo(
    () => visibleRows.filter(isActionableNotification),
    [visibleRows],
  );
  const focus = tab === "action"
    ? actionableRows.find((row) => row.priority === "high") ?? actionableRows[0] ?? null
    : null;
  const nextRows = tab === "action"
    ? actionableRows.filter((row) => row.id !== focus?.id)
    : [];
  const informationRows = visibleRows.filter((row) => !isActionableNotification(row));
  const unreadCount = rows.filter((row) => row.unread).length;
  const activeFilterCount = countActiveNotificationFilters(filters);

  async function updateNotification(row: NotificationRow, dismissed = false) {
    const response = await fetch(`/api/mobile/notifications/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true, dismissed }),
    });
    if (!response.ok) return false;
    window.dispatchEvent(new Event(NOTIFICATION_INBOX_CHANGED_EVENT));
    setRows((current) => dismissed
      ? current.filter((item) => item.id !== row.id)
      : current.map((item) => item.id === row.id ? { ...item, unread: false } : item));
    return true;
  }

  function runAction(row: NotificationRow) {
    const href = notificationHref(row.action);
    startTransition(async () => {
      await updateNotification(row);
      if (!href) return;
      if (/^https?:\/\//i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
      else router.push(href);
    });
  }

  return (
    <div className="min-h-full bg-canvas px-4 py-5 sm:px-6 lg:px-8">
      <header className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-base font-semibold text-slate-500">
              {t("needsActionCount", { count: actionableRows.length })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tab !== "activity" && (
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-primary-200",
                  activeFilterCount > 0
                    ? "border-primary-600 bg-primary-50 text-primary-700"
                    : "border-primary-600 bg-surface text-primary-700 hover:bg-primary-50",
                  "min-w-11 lg:min-w-0",
                )}
              >
                <Filter className="size-4" />
                {t("filter")}
                {activeFilterCount > 0 && (
                  <span className="grid size-5 place-items-center rounded-full bg-primary-600 text-[11px] text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            )}
            <Link
              href={`${Routes.Settings}?tab=notifications`}
              aria-label={t("settings")}
              className="grid size-11 place-items-center rounded-xl border border-border bg-surface text-slate-600 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary-200"
            >
              <Settings className="size-5" />
            </Link>
          </div>
        </div>

        <div className="mt-5 flex gap-1 border-b border-border" role="tablist" aria-label={t("tabs.label")}>
          <TabButton selected={tab === "action"} onClick={() => setTab("action")}>
            {t("tabs.action")}
            {actionableRows.length > 0 && <CountBadge tone="danger">{actionableRows.length}</CountBadge>}
          </TabButton>
          <TabButton selected={tab === "all"} onClick={() => setTab("all")}>
            {t("tabs.all")}
            <CountBadge>{rows.length}</CountBadge>
          </TabButton>
          <TabButton selected={tab === "activity"} onClick={() => setTab("activity")}>
            {t("tabs.activity")}
          </TabButton>
        </div>
      </header>

      <main className="mx-auto mt-6 max-w-6xl">
        {tab === "activity" ? (
          <NotificationsTable rows={activities} />
        ) : loading ? (
          <LoadingState label={t("loading")} />
        ) : error ? (
          <ErrorState label={t("loadError")} retry={t("retry")} onRetry={() => void load()} />
        ) : visibleRows.length === 0 ? (
          <EmptyState label={activeFilterCount > 0 ? t("emptyFiltered") : t("empty")} />
        ) : (
          <div className="space-y-6">
            {focus && tab === "action" && (
              <PriorityFocus
                row={focus}
                actionText={actionLabel(focus.action, t)}
                processedText={t("processed")}
                priorityText={t("highPriority")}
                impactText={t("impact")}
                onAction={() => runAction(focus)}
                onProcessed={() => void updateNotification(focus)}
              />
            )}

            {nextRows.length > 0 && (
              <NotificationSection title={t("next")}>
                {nextRows.map((row) => (
                  <NotificationListRow
                    key={row.id}
                    row={row}
                    actionText={actionLabel(row.action, t)}
                    onAction={() => runAction(row)}
                  />
                ))}
              </NotificationSection>
            )}

            {(informationRows.length > 0 || tab === "all") && (
              <NotificationSection title={tab === "all" ? t("allTitle") : t("information")}>
                {(tab === "all" ? visibleRows.filter((row) => row.id !== focus?.id && !nextRows.some((next) => next.id === row.id)) : informationRows)
                  .map((row) => (
                    <NotificationListRow
                      key={row.id}
                      row={row}
                      actionText={row.action ? actionLabel(row.action, t) : null}
                      onAction={() => runAction(row)}
                    />
                  ))}
              </NotificationSection>
            )}

            <div className="flex items-center gap-5 py-1 text-sm font-bold text-primary-700">
              <span className="h-px flex-1 bg-border" />
              {unreadCount === 0 ? t("allRead") : t("unreadCount", { count: unreadCount })}
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}
      </main>

      <NotificationsFilterDrawer
        open={filterOpen}
        rows={rows}
        tab={tab}
        value={filters}
        onClose={() => setFilterOpen(false)}
        onApply={setFilters}
      />
    </div>
  );
}

function TabButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "relative inline-flex min-h-11 items-center gap-2 px-4 text-sm font-bold text-slate-500 outline-none after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full focus-visible:ring-2 focus-visible:ring-primary-200",
        selected && "text-primary-700 after:bg-primary-600",
        "min-w-11 lg:min-w-0",
      )}
    >
      {children}
    </button>
  );
}

function CountBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "danger" }) {
  return (
    <span className={cn(
      "grid min-w-5 place-items-center rounded-full px-1.5 py-0.5 text-[11px] font-extrabold",
      tone === "danger" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600",
    )}>
      {children}
    </span>
  );
}

function PriorityFocus({
  row,
  actionText,
  processedText,
  priorityText,
  impactText,
  onAction,
  onProcessed,
}: {
  row: NotificationRow;
  actionText: string;
  processedText: string;
  priorityText: string;
  impactText: string;
  onAction: () => void;
  onProcessed: () => void;
}) {
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50/35 px-5 py-6 sm:px-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-red-100 text-red-700">
          {row.category === "lowStock" ? <AlertTriangle className="size-8" /> : <CategoryIcon category={row.category} className="size-7" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-red-700">{priorityText}</div>
          <h2 className="mt-1 text-xl font-extrabold text-slate-950">{row.title}</h2>
          <p className="mt-1 text-sm font-medium text-slate-700">{row.body}</p>
          <p className="mt-1 text-sm text-slate-500">{impactText}</p>
          <NotificationMeta row={row} />
        </div>
        <div className="flex shrink-0 flex-col gap-2 lg:w-48">
          <button type="button" onClick={onAction} className="min-h-11 rounded-xl bg-red-600 px-4 font-extrabold text-white hover:bg-red-700 min-w-11 lg:min-w-0">
            {actionText}
          </button>
          <button type="button" onClick={onProcessed} className="min-h-11 rounded-xl font-bold text-primary-700 hover:bg-primary-50 min-w-11 lg:min-w-0">
            {processedText}
          </button>
        </div>
      </div>
    </section>
  );
}

function NotificationSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-extrabold">{title}</h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface divide-y divide-border">
        {children}
      </div>
    </section>
  );
}

function NotificationListRow({ row, actionText, onAction }: { row: NotificationRow; actionText: string | null; onAction: () => void }) {
  const level = notificationLevel(row.priority);
  const category = notificationCategory(row.category);
  return (
    <article className="flex min-h-20 items-center gap-3 px-4 py-3 sm:px-5">
      <span className={cn("size-2.5 shrink-0 rounded-full", row.unread ? level === "high" ? "bg-red-600" : level === "warning" ? "bg-amber-500" : "bg-blue-600" : "bg-slate-300")} />
      <div className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full",
        level === "high" ? "bg-red-50 text-red-600" : level === "warning" ? "bg-amber-50 text-amber-700" : category === "sales" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-700",
      )}>
        <CategoryIcon category={row.category} className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className={cn("truncate text-sm", row.unread ? "font-extrabold" : "font-semibold")}>{row.title}</h3>
        <p className="mt-0.5 truncate text-xs text-slate-500">{row.body}</p>
      </div>
      <CategoryBadge category={category} />
      <span className="hidden w-32 shrink-0 text-xs text-slate-500 md:block">{formatNotificationTime(row)}</span>
      {actionText ? (
        <button type="button" onClick={onAction} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-bold text-primary-700 hover:bg-primary-50 min-w-11 lg:min-w-0">
          {actionText}
          <ChevronRight className="size-4" />
        </button>
      ) : (
        <ChevronRight className="size-4 shrink-0 text-slate-400" />
      )}
    </article>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const t = useTranslations("notifications.inbox.categories");
  return (
    <span className={cn(
      "hidden shrink-0 rounded-md px-2 py-1 text-[11px] font-bold sm:inline-flex",
      category === "inventory" ? "bg-emerald-50 text-emerald-700" : category === "einvoice" ? "bg-red-50 text-red-700" : category === "debt" ? "bg-amber-50 text-amber-700" : category === "sales" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600",
    )}>
      {t(category)}
    </span>
  );
}

function NotificationMeta({ row }: { row: NotificationRow }) {
  const t = useTranslations("notifications.inbox.categories");
  const category = notificationCategory(row.category);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
      <Box className="size-4" />
      {t(category)}
      <span>·</span>
      {formatNotificationTime(row)}
    </div>
  );
}

function formatNotificationTime(row: NotificationRow) {
  const date = notificationCreatedAt(row);
  if (!date) return "Cập nhật gần đây";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function LoadingState({ label }: { label: string }) {
  return <div className="flex min-h-72 items-center justify-center text-sm font-semibold text-slate-500"><RefreshCw className="mr-2 size-5 animate-spin" />{label}</div>;
}

function ErrorState({ label, retry, onRetry }: { label: string; retry: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center text-center">
      <AlertTriangle className="size-10 text-red-500" />
      <p className="mt-3 text-sm font-semibold text-slate-600">{label}</p>
      <button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-xl border border-primary-600 px-4 font-bold text-primary-700 min-w-11 lg:min-w-0">{retry}</button>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center text-center text-slate-500">
      <Bell className="size-11 text-slate-300" />
      <p className="mt-3 text-sm font-semibold">{label}</p>
    </div>
  );
}
