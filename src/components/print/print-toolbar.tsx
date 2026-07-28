"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, Printer, Settings2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PaperSize, PrintTemplate } from "@/lib/print/template";

const SIZES: { id: PaperSize; label: string }[] = [
  { id: "a4", label: "A4" },
  { id: "a5", label: "A5" },
  { id: "k80", label: "K80" },
];

export function PrintToolbar({
  backHref,
  baseHref,
  size,
  templates = [],
  selectedTemplateId,
}: {
  backHref: string;
  baseHref: string;
  size: PaperSize;
  templates?: PrintTemplate[];
  selectedTemplateId?: string;
}) {
  const t = useTranslations();
  const hrefFor = (params: Record<string, string | undefined>) => {
    const [path, query = ""] = baseHref.split("?");
    const sp = new URLSearchParams(query);
    for (const [key, value] of Object.entries(params)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    const qs = sp.toString();
    return qs ? `${path}?${qs}` : path;
  };

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900 print:hidden lg:flex-nowrap lg:gap-3 lg:px-4">
      <Link href={backHref} className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 lg:min-h-0 lg:min-w-0">
        <ArrowLeft className="w-4 h-4" />
      </Link>
      <span className="min-w-0 flex-1 text-sm font-semibold lg:flex-none">{t("print.title")}</span>
      <button
        onClick={() => window.print()}
        className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 lg:order-last lg:min-h-0 lg:min-w-0"
      >
        <Printer className="h-4 w-4" />
        {t("print.printBtn")}
      </button>
      <div className="order-3 w-full flex gap-1 overflow-x-auto lg:order-none lg:ml-2 lg:w-auto lg:overflow-visible">
        {SIZES.map((s) => (
          <Link
            key={s.id}
            href={hrefFor({ size: s.id, templateId: selectedTemplateId })}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center px-3 py-1.5 rounded-lg text-xs font-medium border lg:min-h-0 lg:min-w-0",
              size === s.id ? "bg-primary-600 text-white border-primary-600" : "border-slate-300 dark:border-slate-700"
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>
      {templates.length > 1 && (
        <Select
          value={selectedTemplateId}
          onChange={(event) => { window.location.href = hrefFor({ size, templateId: event.target.value }); }}
          size="sm"
          options={templates.map((template) => ({ value: template.id, label: template.name }))}
          className="order-4 w-full min-w-0 text-xs font-medium lg:order-none lg:max-w-[220px]"
          aria-label={t("printSettings.templateName")}
        />
      )}
      <Link href="/settings/print" className="order-5 inline-flex min-h-11 min-w-11 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 dark:border-slate-700 lg:order-none lg:w-auto lg:min-h-0 lg:min-w-0">
        <Settings2 className="w-3.5 h-3.5" />
        {t("print.editTemplate")}
      </Link>
      <div className="hidden flex-1 lg:block" />
    </div>
  );
}
