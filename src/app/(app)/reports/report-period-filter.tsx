"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RowPreviewModal } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PERIODS = [
  "today",
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
}: {
  period: ReportPeriod;
  from: string;
  to: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [dateModalOpen, setDateModalOpen] = useState(false);

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
    router.push(`/reports?${params.toString()}`);
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

  function applyCustomPeriod() {
    if (!customFrom || !customTo || customFrom > customTo) return;
    setDateModalOpen(false);
    navigate("custom", customFrom, customTo);
  }

  return (
    <>
      <ReportPeriodChips period={period} onSelect={selectPeriod} />
      <div className="hidden lg:block">
        <ReportPeriodSelect period={period} onSelect={selectPeriod} className="h-9" />
      </div>

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
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-slate-900 focus:border-primary-500 focus:outline-none lg:h-10 dark:text-slate-100"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            <span className="block">{t("reports.period.to")}</span>
            <input
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
  const periods = ["today", "7d", "this_month", "custom"] as const;

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
      options={PERIODS.map((value) => ({
        value,
        label: t(`reports.period.options.${value}` as never),
      }))}
      onValueChange={onSelect}
    />
  );
}
