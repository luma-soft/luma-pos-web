"use client";

import { DateInput } from "@/components/ui/date-input";
import { useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RowPreviewModal } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PERIODS = [
  "today",
  "week",
  "7d",
  "30d",
  "90d",
  "this_month",
  "last_month",
  "this_year",
  "custom",
] as const;

export type ReportPeriod = (typeof PERIODS)[number];

export function ReportPeriodFilter({
  period,
  from,
  to,
  basePath = "/reports",
}: {
  period: ReportPeriod;
  from: string;
  to: string;
  basePath?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [draftPeriod, setDraftPeriod] = useState<ReportPeriod>(period);

  function navigate(nextPeriod: string, nextFrom?: string, nextTo?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    params.delete("page");
    params.set("period", nextPeriod);
    if (nextPeriod === "custom" && nextFrom && nextTo) {
      params.set("from", nextFrom);
      params.set("to", nextTo);
    } else {
      params.delete("from");
      params.delete("to");
    }
    router.push(`${basePath}?${params.toString()}`);
  }

  function selectPeriod(value: string) {
    if (value === "custom") {
      setCustomFrom(from);
      setCustomTo(to);
      setDateModalOpen(true);
      return;
    }
    navigate(value);
  }

  function openMobileRangePicker() {
    setDraftPeriod(period);
    setCustomFrom(from);
    setCustomTo(to);
    setRangeModalOpen(true);
  }

  function applyMobileRange() {
    if (draftPeriod === "custom" && (!customFrom || !customTo || customFrom > customTo)) return;
    setRangeModalOpen(false);
    navigate(draftPeriod, customFrom, customTo);
  }

  function applyCustomPeriod() {
    if (!customFrom || !customTo || customFrom > customTo) return;
    setDateModalOpen(false);
    navigate("custom", customFrom, customTo);
  }

  return (
    <>
      <button
        type="button"
        onClick={openMobileRangePicker}
        aria-haspopup="dialog"
        aria-label={t("reports.period.label")}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:hidden"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t(`reports.period.options.${period}` as never)}</span>
        </span>
        <span className="text-xs text-slate-500">{t("reports.period.label")}</span>
      </button>
      <div className="hidden lg:block">
        <ReportPeriodSelect period={period} onSelect={selectPeriod} className="h-9" />
      </div>

      <RowPreviewModal
        open={rangeModalOpen}
        onClose={() => setRangeModalOpen(false)}
        title={t("reports.period.label")}
        size="full"
        closeLabel={t("common.close")}
        panelClassName="lg:hidden"
        footer={(
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" className="min-h-12 flex-1" onClick={() => setRangeModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" className="min-h-12 flex-1"
              disabled={draftPeriod === "custom" && (!customFrom || !customTo || customFrom > customTo)}
              onClick={applyMobileRange}>
              {t("reports.period.apply")}
            </Button>
          </div>
        )}
      >
        <div className="space-y-3">
          {PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={draftPeriod === option}
              onClick={() => setDraftPeriod(option)}
              className={cn(
                "flex min-h-12 w-full items-center justify-between rounded-xl border px-4 text-left text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                draftPeriod === option
                  ? "border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300"
                  : "border-border bg-surface text-slate-700 dark:text-slate-200",
              )}
            >
              {t(`reports.period.options.${option}` as never)}
              {draftPeriod === option && <Check className="h-5 w-5 shrink-0" aria-hidden="true" />}
            </button>
          ))}
          {draftPeriod === "custom" && (
            <div className="grid gap-3 rounded-xl border border-border bg-canvas p-3">
              <label className="space-y-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <span className="block">{t("reports.period.from")}</span>
                <DateInput type="date" value={customFrom} max={customTo}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="h-12 w-full text-base lg:text-sm" />
              </label>
              <label className="space-y-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <span className="block">{t("reports.period.to")}</span>
                <DateInput type="date" value={customTo} min={customFrom}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="h-12 w-full text-base lg:text-sm" />
              </label>
            </div>
          )}
        </div>
      </RowPreviewModal>

      <RowPreviewModal
        open={dateModalOpen}
        onClose={() => setDateModalOpen(false)}
        title={t("reports.period.customTitle")}
        subtitle={t("reports.period.customDescription")}
        size="md"
        closeLabel={t("common.close")}
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDateModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!customFrom || !customTo || customFrom > customTo}
              onClick={applyCustomPeriod}
            >
              {t("reports.period.apply")}
            </Button>
          </div>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            <span className="block">{t("reports.period.from")}</span>
            <DateInput
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-slate-900 focus:border-primary-500 focus:outline-none lg:h-10 dark:text-slate-100"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            <span className="block">{t("reports.period.to")}</span>
            <DateInput
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(event) => setCustomTo(event.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-slate-900 focus:border-primary-500 focus:outline-none lg:h-10 dark:text-slate-100"
            />
          </label>
        </div>
      </RowPreviewModal>
    </>
  );
}

export function ReportPeriodChips({
  period,
  onSelect,
}: {
  period: ReportPeriod;
  onSelect: (value: string) => void;
}) {
  const t = useTranslations();
  const periods = ["today", "week", "this_month", "custom"] as const;

  return (
    <div role="group" aria-label={t("reports.period.label")} className="grid grid-cols-4 gap-2 lg:hidden">
      {periods.map((value) => {
        const active = value === period;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(value)}
            className={cn(
              "min-h-11 min-w-11 rounded-xl border px-2 text-center text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              active
                ? "border-primary-700 bg-primary-700 text-white shadow-sm"
                : "border-border bg-surface text-slate-600 hover:bg-surface-2 dark:text-slate-300",
            )}
          >
            {t(`reports.period.options.${value}` as never)}
          </button>
        );
      })}
    </div>
  );
}

function ReportPeriodSelect({
  period,
  onSelect,
  className,
}: {
  period: ReportPeriod;
  onSelect: (value: string) => void;
  className?: string;
}) {
  const t = useTranslations();
  return (
    <Select
      value={period}
      aria-label={t("reports.period.label")}
      rootClassName="w-56"
      menuMinWidth={224}
      className={cn(
        className,
        "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
      )}
      options={PERIODS.filter((value) => value !== "week").map((value) => ({
        value,
        label: t(`reports.period.options.${value}` as never),
      }))}
      onValueChange={onSelect}
    />
  );
}
