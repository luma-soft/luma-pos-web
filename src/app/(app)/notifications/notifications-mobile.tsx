"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronLeft,
  Ellipsis,
  FileText,
  ListFilter,
  Package,
  Settings,
  TrendingUp,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";
import { MobileActionSheet } from "@/components/mobile-detail-nav";
import { LabeledRow, MenuAction } from "@/app/(app)/partners/tabs/customer-mobile";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { notificationHref } from "./notification-actions";
import {
  notificationCategory,
  type NotificationAction,
  type NotificationRow,
  type NotificationTab,
} from "./notification-view-model";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  inventory: Package,
  einvoice: FileText,
  sales: TrendingUp,
  debt: UserRoundSearch,
  system: Bell,
};

/** NativeNotificationRecord.inferredAction: rows without an action still get a category default. */
export function mobileNotificationAction(row: NotificationRow): NotificationAction {
  if (row.action?.target || row.action?.href) return row.action;
  switch (notificationCategory(row.category)) {
    case "inventory": return { ...row.action, target: "inventory" };
    case "einvoice": return { ...row.action, target: "invoices" };
    case "sales": return { ...row.action, target: "reports" };
    default: return { ...row.action, target: "detail" };
  }
}

function actionKey(target?: string) {
  switch (target) {
    case "inventory": case "ai": case "aiRestocking": case "restock": case "restocking": return "inventory";
    case "invoices": case "einvoice": return "invoices";
    case "purchases": return "purchases";
    case "customers": case "crm": case "debt": return "customers";
    case "reports": case "sales": return "reports";
    case "shift": return "shift";
    default: return "detail";
  }
}

/** Priority tint: high → red, medium → orange, otherwise accent (LumaTheme.info). */
function priorityTone(priority: string) {
  if (priority === "high") return { text: "text-ios-red", bg: "bg-ios-red/12", dot: "bg-ios-red" };
  if (priority === "medium") return { text: "text-ios-orange", bg: "bg-ios-orange/12", dot: "bg-ios-orange" };
  return { text: "text-ios-accent", bg: "bg-ios-accent/12", dot: "bg-ios-accent" };
}

function timeLabel(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "—";
  if (locale !== "vi") {
    return date.toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${date.getDate()} thg ${date.getMonth() + 1}`;
}

const circle = "grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10";

/**
 * NativeNotificationsView on phones: back + title with a filter / "…" / settings
 * capsule, the All · Action · Activity segmented control, and the inbox rows.
 */
export function NotificationsMobile({
  tab,
  onTabChange,
  allCount,
  visibleRows,
  actionableRows,
  unreadCount,
  loading,
  error,
  pending,
  activeFilterCount,
  onRetry,
  onOpenFilter,
  onMarkAllRead,
  onAction,
  onRead,
  activity,
  activityTotal,
}: {
  tab: NotificationTab;
  onTabChange: (tab: NotificationTab) => void;
  allCount: number;
  visibleRows: NotificationRow[];
  actionableRows: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  error: boolean;
  pending: boolean;
  activeFilterCount: number;
  onRetry: () => void;
  onOpenFilter: () => void;
  onMarkAllRead: () => void;
  onAction: (row: NotificationRow) => void;
  onRead: (row: NotificationRow) => void;
  activity: ReactNode;
  activityTotal: number;
}) {
  const t = useTranslations("mobile.notifications");
  const tc = useTranslations();
  const locale = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [detail, setDetail] = useState<NotificationRow | null>(null);
  const highlighted = actionableRows.find((row) => row.priority === "high") ?? actionableRows[0];

  const open = (row: NotificationRow) => {
    setDetail(row);
    if (row.unread) onRead(row);
  };
  const act = (row: NotificationRow) => {
    const action = mobileNotificationAction(row);
    if (!notificationHref(action)) return open(row);
    onAction({ ...row, action });
  };

  const section = (rows: NotificationRow[], title: string) => (
    <section key={title}>
      <div className="flex items-baseline justify-between px-ios-inset pb-2 pt-4 text-[17px] text-ios-label-secondary">
        <span>{title}</span>
        <span>{t("unread", { count: unreadCount })}</span>
      </div>
      <div className="border-y border-border bg-surface">
        {rows.map((row) => (
          <NotificationMobileRow key={row.id} row={row} locale={locale} pending={pending} onOpen={() => open(row)} onAction={() => act(row)} />
        ))}
      </div>
    </section>
  );

  const detailAction = detail ? mobileNotificationAction(detail) : null;
  const detailCategory = detail ? notificationCategory(detail.category) : "system";
  const DetailIcon = CATEGORY_ICON[detailCategory] ?? Bell;

  return (
    <div className="min-h-full bg-canvas pb-6 lg:hidden">
      <header className="sticky top-0 z-20 bg-canvas/85 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl">
        <div className="flex items-center gap-3 px-ios-inset">
          <Link href={Routes.More} aria-label={tc("common.back")} data-button-radius="pill" className={`${circle} text-ios-label`}>
            <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <h1 className={cn("min-w-0 flex-1 truncate text-[17px] font-semibold", tab === "activity" && "text-center")}>{t("title")}</h1>
          <div className={cn("flex h-11 shrink-0 items-center gap-1 rounded-full border border-black/[0.06] bg-surface/90 px-1.5 text-ios-accent shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10", tab === "activity" && "w-11 justify-center px-0")}>
            {tab !== "activity" && (
              <>
                <button type="button" onClick={onOpenFilter} aria-label={t("filters")} data-button-radius="pill" className="relative grid size-10 place-items-center rounded-full">
                  <span className={cn("grid size-[26px] place-items-center rounded-full border-2 border-current", activeFilterCount > 0 && "bg-ios-accent text-white border-ios-accent")}>
                    <ListFilter className="size-3.5" strokeWidth={3} aria-hidden="true" />
                  </span>
                </button>
                <button type="button" onClick={() => setMenuOpen(true)} aria-label={t("moreActions")} aria-haspopup="dialog" data-button-radius="pill" className="grid size-10 place-items-center rounded-full">
                  <span className="grid size-[26px] place-items-center rounded-full border-2 border-current">
                    <Ellipsis className="size-4" strokeWidth={3} aria-hidden="true" />
                  </span>
                </button>
              </>
            )}
            <Link href={`${Routes.Settings}?tab=notifications`} aria-label={t("settings")} data-button-radius="pill" className="grid size-10 place-items-center rounded-full">
              <Settings className="size-[25px]" strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <div className="px-ios-inset pt-2" role="tablist" aria-label={t("modeLabel")}>
        <div className="grid grid-cols-3 rounded-full bg-ios-accent/10 p-1">
          {([
            ["all", t("modeAll", { count: allCount })],
            ["action", t("modeAction", { count: actionableRows.length })],
            ["activity", t("modeActivity")],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => onTabChange(key)}
              data-button-radius="pill"
              className={cn("min-h-10 truncate rounded-full px-1 text-[15px] font-medium", tab === key ? "bg-ios-accent font-semibold text-white" : "text-ios-label")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "activity" ? (
        <section>
          <div className="flex items-baseline justify-between px-ios-inset pb-2 pt-4 text-[17px] text-ios-label-secondary">
            <span>{t("activityTitle")}</span>
            <span>{t("activityCount", { count: activityTotal })}</span>
          </div>
          {activity}
        </section>
      ) : (
        <>
          {error && (
            <div className="mx-ios-inset mt-4 rounded-[14px] bg-surface px-4 py-3">
              <p className="text-[15px] text-ios-red">{t("loadError")}</p>
              <button type="button" onClick={onRetry} className="mt-1 min-h-9 text-[15px] font-semibold text-ios-accent">{t("retry")}</button>
            </div>
          )}
          {loading ? (
            <section aria-busy="true">
              <div className="px-ios-inset pb-2 pt-4 text-[17px] text-ios-label-secondary">{t("loading")}</div>
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="flex items-center gap-3 px-ios-inset py-3" aria-hidden="true">
                  <span className="size-[38px] shrink-0 animate-pulse rounded-lg bg-black/[0.08] dark:bg-white/10" />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block h-[13px] animate-pulse rounded bg-black/[0.08] dark:bg-white/10" />
                    <span className="block h-[11px] w-[190px] animate-pulse rounded bg-black/[0.08] dark:bg-white/10" />
                  </span>
                </div>
              ))}
            </section>
          ) : (tab === "action" ? actionableRows.length === 0 : visibleRows.length === 0) ? (
            !error && (
              <div className="px-8 pt-16 text-center">
                <p className="text-[20px] font-semibold">{t(tab === "action" ? "emptyActionTitle" : "emptyTitle")}</p>
                <p className="mt-2 text-[15px] text-ios-label-secondary">{t(tab === "action" ? "emptyActionMessage" : "emptyMessage")}</p>
              </div>
            )
          ) : tab === "action" ? (
            <>
              {highlighted && section([highlighted], t("priorityFocus"))}
              {actionableRows.length > 1 && section(actionableRows.filter((row) => row.id !== highlighted?.id), t("moreActionable"))}
            </>
          ) : (
            section(visibleRows, t("inbox"))
          )}
        </>
      )}

      <MobileActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={t("moreActions")}>
        <div className="space-y-2">
          <MenuAction icon={CheckCircle2} label={t("markAllRead")} disabled={unreadCount === 0} onSelect={() => { setMenuOpen(false); onMarkAllRead(); }} />
        </div>
      </MobileActionSheet>

      <MobileActionSheet open={detail !== null} onClose={() => setDetail(null)} title={t("detailTitle")}>
        {detail && (
          <div className="space-y-ios-section">
            <div className="rounded-[14px] bg-surface px-4 py-3">
              <div className="flex items-start gap-2.5 text-[17px] font-semibold">
                <DetailIcon className="mt-0.5 size-5 shrink-0 text-ios-accent" aria-hidden="true" />
                <span>{detail.title}</span>
              </div>
              <p className="mt-2 text-[15px] text-ios-label-secondary">{detail.body}</p>
            </div>
            <div className="overflow-hidden rounded-[14px] bg-surface">
              <LabeledRow label={t("detailCategory")} value={t(`category.${detailCategory}` as never)} />
              <LabeledRow label={t("detailPriority")} value={t(`priority.${detail.priority === "high" || detail.priority === "medium" ? detail.priority : "low"}` as never)} />
              <LabeledRow label={t("detailTime")} value={timeLabel(detail.createdAt, locale)} />
            </div>
            {detailAction && notificationHref(detailAction) && (
              <MenuAction
                icon={ArrowUpRight}
                label={detail.action?.viLabel ?? detail.action?.label ?? t(`action.${actionKey(detailAction.target)}` as never)}
                disabled={pending}
                onSelect={() => {
                  const row = detail;
                  setDetail(null);
                  onAction({ ...row, action: detailAction });
                }}
              />
            )}
          </div>
        )}
      </MobileActionSheet>
    </div>
  );
}

/** NativeNotificationRowView: unread dot, tinted category tile, title/body, category chip + time, action pill. */
function NotificationMobileRow({
  row,
  locale,
  pending,
  onOpen,
  onAction,
}: {
  row: NotificationRow;
  locale: string;
  pending: boolean;
  onOpen: () => void;
  onAction: () => void;
}) {
  const t = useTranslations("mobile.notifications");
  const tone = priorityTone(row.priority);
  const category = notificationCategory(row.category);
  const Icon = CATEGORY_ICON[category] ?? Bell;
  const action = mobileNotificationAction(row);
  const label = row.action?.viLabel ?? row.action?.label ?? t(`action.${actionKey(action.target)}` as never);
  return (
    <div className="flex items-center gap-2.5 border-b border-border py-3.5 pl-ios-inset pr-ios-inset last:border-b-0">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
        <span className={cn("mt-[15px] size-2 shrink-0 rounded-full", row.unread ? tone.dot : "border border-ios-stroke/60")} aria-hidden="true" />
        <span className={cn("grid size-[38px] shrink-0 place-items-center rounded-[11px]", tone.bg, tone.text)}>
          <Icon className="size-[19px]" strokeWidth={2.3} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 space-y-[5px]">
          <span className={cn("line-clamp-2 text-[15px] leading-5", row.unread ? "font-semibold" : "font-normal")}>{row.title}</span>
          <span className="line-clamp-2 text-[13px] leading-[18px] text-ios-label-secondary">{row.body}</span>
          <span className="flex items-center gap-[7px]">
            <span className={cn("rounded-[5px] px-[7px] py-[3px] text-[11px] font-semibold leading-none", tone.text, tone.bg)}>{t(`category.${category}` as never)}</span>
            <span className="text-[11px] text-ios-label-tertiary">{timeLabel(row.createdAt, locale)}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onAction}
        disabled={pending}
        data-button-radius="pill"
        className="shrink-0 whitespace-nowrap rounded-full bg-ios-accent/15 px-3 py-[7px] text-[12px] font-semibold text-ios-accent disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}

