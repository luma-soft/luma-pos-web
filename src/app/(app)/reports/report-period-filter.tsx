"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { RowPreviewModal } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PERIODS = [
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
  const [disclosureOpen, setDisclosureOpen] = useState(false);

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
    setDisclosureOpen(false);
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
      <ReportPeriodDisclosure
        period={period}
        open={disclosureOpen}
        onToggle={() => setDisclosureOpen((open) => !open)}
        onSelect={selectPeriod}
      />
      <div className="hidden lg:block">
        <ReportPeriodSelect period={period} onSelect={selectPeriod} className="h-9 min-w-40" />
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
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 sm:h-10 dark:text-slate-100"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            <span className="block">{t("reports.period.to")}</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(event) => setCustomTo(event.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 sm:h-10 dark:text-slate-100"
            />
          </label>
        </div>
      </RowPreviewModal>
    </>
  );
}

export function ReportPeriodDisclosure({
  period,
  open,
  onToggle,
  onSelect,
}: {
  period: ReportPeriod;
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}) {
  const t = useTranslations();
  const controlId = "report-period-mobile-control";

  return (
    <div className="rounded-xl border border-border bg-surface lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controlId}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-400">
            {t("reports.period.label")}
          </span>
          <span className="block truncate text-sm font-bold">
            {t(`reports.period.options.${period}` as never)}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          id={controlId}
          role="group"
          aria-label={t("reports.period.label")}
          className="grid grid-cols-2 gap-1 border-t border-border-soft p-2"
        >
          {PERIODS.map((value) => {
            const active = value === period;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(value)}
                className={cn(
                  "min-h-11 rounded-lg px-2 py-2 text-left text-sm font-semibold leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                  active
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"
                    : "text-slate-600 hover:bg-surface-2 dark:text-slate-300",
                )}
              >
                {t(`reports.period.options.${value}` as never)}
              </button>
            );
          })}
        </div>
      )}
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
      className={className}
      options={PERIODS.map((value) => ({
        value,
        label: t(`reports.period.options.${value}` as never),
      }))}
      onValueChange={onSelect}
    />
  );
}
