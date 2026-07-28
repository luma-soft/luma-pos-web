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
    <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 flex items-center gap-3 print:hidden">
      <Link href={backHref} className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 lg:min-h-0 lg:min-w-0">
        <ArrowLeft className="w-4 h-4" />
      </Link>
      <span className="font-semibold text-sm">{t("print.title")}</span>
      <div className="flex gap-1 ml-2">
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
          className="max-w-[220px] text-xs font-medium"
          aria-label={t("printSettings.templateName")}
        />
      )}
      <Link href="/settings/print" className="inline-flex min-h-11 min-w-11 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-500 lg:min-h-0 lg:min-w-0">
        <Settings2 className="w-3.5 h-3.5" />
        {t("print.editTemplate")}
      </Link>
      <div className="flex-1" />
      <button
        onClick={() => window.print()}
        className="inline-flex min-h-11 min-w-11 items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium lg:min-h-0 lg:min-w-0"
      >
        <Printer className="w-4 h-4" />
        {t("print.printBtn")}
      </button>
    </div>
  );
}
