"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DateInput } from "@/components/ui/date-input";
import { ProfitVisibility } from "@/components/profit-visibility";
import { cn } from "@/lib/utils";

const PERIODS = ["all", "today", "yesterday", "7days", "30days", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "thisYear", "lastYear", "custom"] as const;
type Period = (typeof PERIODS)[number];
type DateRange = { from?: string; to?: string };

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDay(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function rangeFor(period: Period, now = new Date()): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = (date: Date) => isoDay(date);
  switch (period) {
    case "all": return {};
    case "today": return { from: start(today), to: start(today) };
    case "yesterday": return { from: start(shiftDay(today, -1)), to: start(shiftDay(today, -1)) };
    case "7days": return { from: start(shiftDay(today, -6)), to: start(today) };
    case "30days": return { from: start(shiftDay(today, -29)), to: start(today) };
    case "thisWeek": {
      const mondayOffset = (today.getDay() + 6) % 7;
      return { from: start(shiftDay(today, -mondayOffset)), to: start(today) };
    }
    case "lastWeek": {
      const mondayOffset = (today.getDay() + 6) % 7;
      const thisMonday = shiftDay(today, -mondayOffset);
      return { from: start(shiftDay(thisMonday, -7)), to: start(shiftDay(thisMonday, -1)) };
    }
    case "thisMonth": return { from: start(new Date(today.getFullYear(), today.getMonth(), 1)), to: start(today) };
    case "lastMonth": return { from: start(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: start(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case "thisYear": return { from: start(new Date(today.getFullYear(), 0, 1)), to: start(today) };
    case "lastYear": return { from: start(new Date(today.getFullYear() - 1, 0, 1)), to: start(new Date(today.getFullYear() - 1, 11, 31)) };
    case "custom": return {};
  }
}

export function CustomerGrossProfit({ customerId }: { customerId: string }) {
  const t = useTranslations("customerProfit");
  const tDashboard = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>("all");
  const [customFrom, setCustomFrom] = useState(isoDay(shiftDay(new Date(), -29)));
  const [customTo, setCustomTo] = useState(isoDay(new Date()));
  const [range, setRange] = useState<DateRange>({});
  const [grossProfit, setGrossProfit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const popupId = useId();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setGrossProfit(null);
    const query = new URLSearchParams();
    if (range.from) query.set("from", range.from);
    if (range.to) query.set("to", range.to);
    fetch(`/api/partners/customers/${encodeURIComponent(customerId)}/gross-profit?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error("Unable to load gross profit");
        setGrossProfit(Number(payload.data.grossProfit) || 0);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(true);
        setGrossProfit(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [customerId, range]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 16);
      const height = Math.min(480, window.innerHeight - 16);
      const top = rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
      setPosition({ position: "fixed", width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top, maxHeight: height });
    };
    const dismissOutside = (event: Event) => {
      const target = event.target as Node;
      if (target instanceof Element) {
        const nestedDialog = target.closest('[role="dialog"]');
        if (nestedDialog && nestedDialog.id !== popupId) return;
      }
      if (!triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    reposition();
    document.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.requestAnimationFrame(() => popupRef.current?.querySelector<HTMLButtonElement>("[aria-selected='true']")?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const periodLabel = period === "custom" && customFrom && customTo
    ? new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(`${customFrom}T12:00:00`))
      + " – " + new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(`${customTo}T12:00:00`))
    : t(`periods.${period}`);

  function choosePeriod(next: Period) {
    setPeriod(next);
    if (next === "custom") {
      const defaultRange = rangeFor("30days");
      const from = customFrom || defaultRange.from || "";
      const to = customTo || defaultRange.to || "";
      setCustomFrom(from);
      setCustomTo(to);
      if (from && to) setRange({ from, to });
      return;
    }
    setRange(rangeFor(next));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }

  return (
    <div className="mt-4 rounded-lg border border-border-soft px-3 py-2.5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-slate-500">{tDashboard("grossProfit")}</div>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((current) => !current)}
            onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? popupId : undefined}
            className="mt-0.5 inline-flex min-h-11 items-center gap-1 rounded-md text-xs text-slate-500 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-primary-600"
          >
            {periodLabel}<ChevronDown className="size-3" />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2" aria-label={tCommon("loading")}>
            <div className="h-4 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <LoaderCircle className="size-4 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <span className="text-sm text-slate-400">—</span>
        ) : grossProfit !== null ? (
          <ProfitVisibility key={`${customerId}:${range.from ?? "all"}:${range.to ?? "all"}`} label="" value={grossProfit} className="gap-1" />
        ) : null}
      </div>

      {open && (
        <div
          ref={popupRef}
          id={popupId}
          role="dialog"
          aria-label={t("periods.all")}
          style={position}
          onKeyDown={handlePickerKeyDown}
          className="z-[115] overflow-auto rounded-xl border border-border bg-surface p-3 text-slate-900 shadow-e2 dark:text-slate-100"
        >
          <div className="grid gap-1" role="listbox" aria-label={t("periods.all")}>
            {PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={period === value}
                onClick={() => choosePeriod(value)}
                className={cn(
                  "min-h-10 rounded-lg px-3 text-left text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary-600",
                  period === value && "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-300",
                )}
              >
                {t(`periods.${value}`)}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="mt-3 grid gap-2 border-t border-border-soft pt-3">
              <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                {t("from")}
                <DateInput type="date" value={customFrom} max={customTo || undefined} onChange={(event) => {
                  const next = event.currentTarget.value;
                  setCustomFrom(next);
                  if (next && customTo) setRange({ from: next, to: customTo });
                }} />
              </label>
              <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                {t("to")}
                <DateInput type="date" value={customTo} min={customFrom || undefined} onChange={(event) => {
                  const next = event.currentTarget.value;
                  setCustomTo(next);
                  if (customFrom && next) setRange({ from: customFrom, to: next });
                }} />
              </label>
            </div>
          )}
        </div>
      )}
      {error && <span className="sr-only">{tCommon("error")}</span>}
    </div>
  );
}
