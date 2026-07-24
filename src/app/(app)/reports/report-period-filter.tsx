"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RowPreviewModal } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

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
      <Select
        value={period}
        aria-label={t("reports.period.label")}
        className="h-9 min-w-40"
        options={PERIODS.map((value) => ({
          value,
          label: t(`reports.period.options.${value}` as never),
        }))}
        onValueChange={selectPeriod}
      />

      <RowPreviewModal
        open={dateModalOpen}
        onClose={() => setDateModalOpen(false)}
        title={t("reports.period.customTitle")}
        subtitle={t("reports.period.customDescription")}
        size="md"
        closeLabel={t("common.close")}
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDateModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
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
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:text-slate-100"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            <span className="block">{t("reports.period.to")}</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(event) => setCustomTo(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:text-slate-100"
            />
          </label>
        </div>
      </RowPreviewModal>
    </>
  );
}
