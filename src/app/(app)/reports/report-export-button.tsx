"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

/** Desktop: download the current tab and period as CSV. */
export function ReportExportButton({ tab }: { tab: string }) {
  const t = useTranslations("reports.d");
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  params.set("tab", tab);
  params.delete("page");
  params.delete("size");
  return (
    <a
      href={`/reports/export?${params.toString()}`}
      download
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-slate-700 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-200"
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {t("export")}
    </a>
  );
}
