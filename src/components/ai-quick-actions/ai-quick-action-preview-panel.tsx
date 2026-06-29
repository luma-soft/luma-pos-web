"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AiActionPreview } from "@/lib/ai/actions";
import { fieldValue, previewMatchedCount, previewUnresolvedCount } from "./utils";

function toneClass(tone?: string) {
  if (tone === "danger") return "text-er";
  if (tone === "warning") return "text-warn";
  if (tone === "success") return "text-primary-700";
  return "text-slate-700 dark:text-slate-200";
}

export function AiQuickActionPreviewPanel({
  preview,
  compact = false,
}: {
  preview: AiActionPreview;
  compact?: boolean;
}) {
  const t = useTranslations();
  const matchedCount = previewMatchedCount(preview);
  const unresolvedCount = previewUnresolvedCount(preview);

  return (
    <div className="grid gap-3">
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
        <div className="rounded-xl border border-border-soft bg-surface-2 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("aiQuick.preview.status")}</div>
          <div className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{preview.state}</div>
        </div>
        <div className="rounded-xl border border-border-soft bg-surface-2 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("aiQuick.preview.matched")}</div>
          <div className="mt-1 text-sm font-bold text-primary-700">{matchedCount}</div>
        </div>
        <div className="rounded-xl border border-border-soft bg-surface-2 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("aiQuick.preview.unresolved")}</div>
          <div className={cn("mt-1 text-sm font-bold", unresolvedCount ? "text-warn" : "text-slate-700 dark:text-slate-200")}>{unresolvedCount}</div>
        </div>
        <div className="rounded-xl border border-border-soft bg-surface-2 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("aiQuick.preview.confidence")}</div>
          <div className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">{Math.round(preview.confidence * 100)}%</div>
        </div>
      </div>

      {preview.fields.length > 0 && (
        <div className="grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("aiQuick.preview.supplier")}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{fieldValue(preview.fields, "Nhà cung cấp")}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("aiQuick.preview.warehouse")}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{fieldValue(preview.fields, "Kho")}</div>
          </div>
        </div>
      )}

      {preview.lines.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] bg-surface-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <div>{t("aiQuick.preview.item")}</div>
            <div>{t("aiQuick.preview.quantity")}</div>
          </div>
          <div className="divide-y divide-border-soft">
            {preview.lines.map((line) => (
              <div key={`${line.label}-${line.value}-${line.meta ?? ""}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{line.label}</div>
                  {line.meta && <div className="mt-0.5 truncate text-[11px] text-slate-400">{line.meta}</div>}
                </div>
                <div className={cn("text-right font-mono text-sm font-bold", toneClass(line.tone))}>{line.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.warnings.map((warning) => (
        <div key={warning} className="flex gap-2 rounded-xl border border-warn/20 bg-warn-soft px-3 py-2.5 text-xs font-semibold text-warn">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{warning}</span>
        </div>
      ))}

      {matchedCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{t("aiQuick.preview.noMutationYet")}</span>
        </div>
      )}
    </div>
  );
}
