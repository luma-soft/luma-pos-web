"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Filter,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Routes } from "@/lib/routes";
import { notificationHref } from "./notification-actions";
import { NOTIFICATION_INBOX_CHANGED_EVENT } from "@/lib/notifications/inbox-count";
import { InboxNotificationsTable, NotificationsTable, type AuditRow } from "./notifications-table";
import { NotificationsFilterDrawer } from "./notifications-filter-drawer";
import { Pagination } from "@/components/pagination";
import {
  applyNotificationFilters,
  countActiveNotificationFilters,
  defaultNotificationFilters,
  isActionableNotification,
  paginateNotificationRows,
  type NotificationFilters,
  type NotificationRow,
  type NotificationTab,
} from "./notification-view-model";

type NotificationsPayload = {
  rows?: NotificationRow[];
  counts?: { all?: number; unread?: number };
};

type ActivityPage = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

export function NotificationsClient({ activities: initialActivities }: { activities: ActivityPage }) {
  const t = useTranslations("notifications.inbox");
  const activityT = useTranslations("notifications.activity");
  const router = useRouter();
  const [tab, setTab] = useState<NotificationTab>("action");
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updateError, setUpdateError] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const updating = useRef(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<NotificationFilters>(defaultNotificationFilters);
  const [pages, setPages] = useState<Record<NotificationTab, number>>({ action: 1, all: 1, activity: initialActivities.page });
  const [pageSizes, setPageSizes] = useState<Record<NotificationTab, number>>({ action: 15, all: 15, activity: initialActivities.pageSize });
  const [activities, setActivities] = useState(initialActivities);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(false);
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
  const activeFilterCount = countActiveNotificationFilters(filters);
  const inboxRows = tab === "action" ? actionableRows : visibleRows;
  const inboxPageData = paginateNotificationRows(inboxRows, pages[tab], pageSizes[tab]);

  const loadActivityPage = useCallback(async (page: number, pageSize: number) => {
    setActivityLoading(true);
    setActivityError(false);
    try {
      const response = await fetch(`/api/notifications/activity?page=${page}&size=${pageSize}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; data?: ActivityPage };
      if (!response.ok || !payload.ok || !payload.data || !Array.isArray(payload.data.rows)) throw new Error("activity_failed");
      setActivities(payload.data);
      setPages((current) => ({ ...current, activity: payload.data!.page }));
      setPageSizes((current) => ({ ...current, activity: payload.data!.pageSize }));
    } catch {
      setActivityError(true);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  async function updateNotification(row: NotificationRow, dismissed = false) {
    if (updating.current) return false;
    updating.current = true;
    setPendingId(row.id);
    setUpdateError(false);
    try {
      const response = await fetch(`/api/mobile/notifications/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read: true, dismissed }),
      });
      const payload = await response.json() as { ok?: boolean };
      if (!response.ok || !payload.ok) throw new Error("notification_update_failed");
      setRows((current) => dismissed
        ? current.filter((item) => item.id !== row.id)
        : current.map((item) => item.id === row.id ? { ...item, unread: false } : item));
      window.dispatchEvent(new Event(NOTIFICATION_INBOX_CHANGED_EVENT));
      return true;
    } catch {
      setUpdateError(true);
      return false;
    } finally {
      updating.current = false;
      setPendingId(null);
    }
  }

  function runAction(row: NotificationRow) {
    if (updating.current) return;
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
              {tab === "activity" ? activityT("description") : t("needsActionCount", { count: actionableRows.length })}
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
        {updateError && (
          <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {t("updateError")}
          </p>
        )}
        {tab === "activity" ? (
          activityLoading ? (
            <LoadingState label={t("loading")} />
          ) : activityError ? (
            <ErrorState label={t("loadError")} retry={t("retry")} onRetry={() => void loadActivityPage(pages.activity, pageSizes.activity)} />
          ) : (
            <>
              <NotificationsTable rows={activities.rows} />
              <Pagination
                page={activities.page}
                pageCount={activities.pageCount}
                total={activities.total}
                pageSize={activities.pageSize}
                unitLabel={activityT("unitLabel")}
                onPageChange={(page) => void loadActivityPage(page, activities.pageSize)}
                onPageSizeChange={(pageSize) => void loadActivityPage(1, pageSize)}
              />
            </>
          )
        ) : loading ? (
          <LoadingState label={t("loading")} />
        ) : error ? (
          <ErrorState label={t("loadError")} retry={t("retry")} onRetry={() => void load()} />
        ) : visibleRows.length === 0 ? (
          <EmptyState label={activeFilterCount > 0 ? t("emptyFiltered") : t("empty")} />
        ) : (
          <>
            <InboxNotificationsTable
              rows={inboxPageData.rows}
              tab={tab}
              pendingId={pendingId}
              onAction={runAction}
              onProcessed={(row) => void updateNotification(row)}
            />
            <Pagination
              page={inboxPageData.page}
              pageCount={inboxPageData.pageCount}
              total={inboxPageData.total}
              pageSize={inboxPageData.pageSize}
              unitLabel={t("unitLabel")}
              onPageChange={(page) => setPages((current) => ({ ...current, [tab]: page }))}
              onPageSizeChange={(pageSize) => {
                setPageSizes((current) => ({ ...current, [tab]: pageSize }));
                setPages((current) => ({ ...current, [tab]: 1 }));
              }}
            />
          </>
        )}
      </main>

      <NotificationsFilterDrawer
        open={filterOpen}
        rows={rows}
        tab={tab}
        value={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(value) => {
          setFilters(value);
          setPages((current) => ({ ...current, action: 1, all: 1 }));
        }}
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
