"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { buttonVariants } from "@/components/ui/button-variants";
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

  function navigate(nextPeriod: string, nextFrom?: string, nextTo?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
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

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select
        value={period}
        aria-label={t("reports.period.label")}
        className="min-w-40"
        options={PERIODS.map((value) => ({
          value,
          label: t(`reports.period.options.${value}` as never),
        }))}
        onValueChange={(value) => navigate(value, customFrom, customTo)}
      />

      {period === "custom" && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span>{t("reports.period.from")}</span>
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="h-10 rounded-lg border border-border bg-surface px-2.5 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:text-slate-100"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span>{t("reports.period.to")}</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(event) => setCustomTo(event.target.value)}
              className="h-10 rounded-lg border border-border bg-surface px-2.5 text-sm text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:text-slate-100"
            />
          </label>
          <button
            type="button"
            disabled={!customFrom || !customTo || customFrom > customTo}
            onClick={() => navigate("custom", customFrom, customTo)}
            className={cn(buttonVariants({ size: "sm" }), "h-10")}
          >
            {t("reports.period.apply")}
          </button>
        </div>
      )}
    </div>
  );
}
