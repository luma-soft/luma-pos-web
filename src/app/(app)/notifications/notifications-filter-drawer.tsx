"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  LumaDateRangePicker,
  LumaWebPicker,
  collectFocusableElements,
} from "@/app/(app)/sales/tabs/filter-drawer-shared";
import {
  applyNotificationFilters,
  countActiveNotificationFilters,
  defaultNotificationFilters,
  resolvedNotificationRange,
  type NotificationFilters,
  type NotificationRow,
  type NotificationTab,
} from "./notification-view-model";

type Props = {
  open: boolean;
  rows: NotificationRow[];
  tab: NotificationTab;
  value: NotificationFilters;
  onClose: () => void;
  onApply: (filters: NotificationFilters) => void;
};

const timePresets = ["all", "today", "7d", "30d", "custom"] as const;
const statuses = ["all", "action", "unread", "processed"] as const;
const levels = ["all", "high", "warning", "info"] as const;

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function NotificationsFilterDrawer({
  open,
  rows,
  tab,
  value,
  onClose,
  onApply,
}: Props) {
  const t = useTranslations("notifications.filter");
  const panelRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState(value);

  const close = useCallback(() => {
    setDraft(value);
    onClose();
  }, [onClose, value]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => collectFocusableElements(panel);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (event.defaultPrevented || panel?.querySelector('[role="listbox"]')) {
          return;
        }
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) return;
      const current = elements.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? current <= 0 ? elements.length - 1 : current - 1
        : current < 0 || current === elements.length - 1 ? 0 : current + 1;
      event.preventDefault();
      elements[next]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  const resultCount = useMemo(
    () => applyNotificationFilters(rows, draft, tab).length,
    [draft, rows, tab],
  );
  const activeCount = countActiveNotificationFilters(draft);
  const resolvedRange = resolvedNotificationRange(draft.timePreset);

  function selectTimePreset(preset: (typeof timePresets)[number]) {
    if (preset === "custom") {
      const fallback = resolvedNotificationRange("7d")!;
      setDraft((current) => ({
        ...current,
        timePreset: preset,
        from: current.from || dateInputValue(fallback.from),
        to: current.to || dateInputValue(fallback.to),
      }));
      return;
    }
    setDraft((current) => ({ ...current, timePreset: preset }));
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/35"
      role="presentation"
      onMouseDown={close}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-filter-title"
        className="ml-auto flex h-full w-full max-w-[460px] flex-col bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start border-b border-border px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 id="notifications-filter-title" className="text-xl font-extrabold">
              {t("title")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("selectedCount", { count: activeCount })}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("close")}
            className="grid size-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <FilterSection title={t("time.title")}>
            <div className="grid grid-cols-5 gap-2">
              {timePresets.map((preset) => (
                <FilterChoice
                  key={preset}
                  selected={draft.timePreset === preset}
                  onClick={() => selectTimePreset(preset)}
                >
                  {t(`time.${preset}`)}
                </FilterChoice>
              ))}
            </div>
            {draft.timePreset === "custom" ? (
              <LumaDateRangePicker
                fromName="notificationFrom"
                toName="notificationTo"
                from={draft.from}
                to={draft.to}
                error=""
                onChange={(from, to) => setDraft((current) => ({ ...current, from, to }))}
              />
            ) : resolvedRange ? (
              <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-slate-600">
                <CalendarDays className="size-4 text-primary-600" />
                {displayDate(resolvedRange.from)} – {displayDate(resolvedRange.to)}
              </div>
            ) : null}
          </FilterSection>

          <FilterSection title={t("status.title")}>
            <div className="grid grid-cols-4 gap-2">
              {statuses.map((status) => (
                <FilterChoice
                  key={status}
                  selected={draft.status === status}
                  onClick={() => setDraft((current) => ({ ...current, status }))}
                >
                  {t(`status.${status}`)}
                </FilterChoice>
              ))}
            </div>
          </FilterSection>

          <FilterSection title={t("level.title")}>
            <div className="grid grid-cols-4 gap-2">
              {levels.map((level) => (
                <FilterChoice
                  key={level}
                  selected={draft.level === level}
                  onClick={() => setDraft((current) => ({ ...current, level }))}
                >
                  {t(`level.${level}`)}
                </FilterChoice>
              ))}
            </div>
          </FilterSection>

          <FilterSection title={t("category.title")}>
            <LumaWebPicker
              ariaLabel={t("category.title")}
              name="notificationCategory"
              value={draft.category}
              options={[
                { value: "all", label: t("category.all") },
                { value: "inventory", label: t("category.inventory") },
                { value: "einvoice", label: t("category.einvoice") },
                { value: "debt", label: t("category.debt") },
                { value: "sales", label: t("category.sales") },
                { value: "system", label: t("category.system") },
              ]}
              onChange={(category) => setDraft((current) => ({ ...current, category }))}
            />
          </FilterSection>

          <FilterSection title={t("source.title")}>
            <LumaWebPicker
              ariaLabel={t("source.title")}
              name="notificationSource"
              value={draft.source}
              options={[
                { value: "all", label: t("source.all") },
                { value: "ai", label: t("source.ai") },
                { value: "mobile", label: t("source.mobile") },
                { value: "pos", label: t("source.pos") },
                { value: "system", label: t("source.system") },
              ]}
              onChange={(source) => setDraft((current) => ({ ...current, source }))}
            />
          </FilterSection>
        </div>

        <footer className="grid grid-cols-2 gap-3 border-t border-border bg-surface px-6 py-4">
          <button
            type="button"
            onClick={() => setDraft(defaultNotificationFilters)}
            className="min-h-11 rounded-xl border border-primary-600 font-bold text-primary-700 hover:bg-primary-50 min-w-11 lg:min-w-0"
          >
            {t("clear")}
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className="min-h-11 rounded-xl bg-primary-600 px-4 font-bold text-white hover:brightness-105 min-w-11 lg:min-w-0"
          >
            {t("view", { count: resultCount })}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

function FilterChoice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-xl border px-2 text-xs font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-primary-200",
        selected
          ? "border-primary-600 bg-primary-50 text-primary-700"
          : "border-border bg-surface text-slate-600 hover:bg-surface-2",
        "min-w-11 lg:min-w-0",
      )}
    >
      {children}
    </button>
  );
}
