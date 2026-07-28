"use client";

import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AiActionPreview } from "@/lib/ai/actions";
import type { Msg, PreviewResolutionState } from "./types";
import { isPosCartPreview, storeAiWorkflowDraft, storePosDraft } from "./utils";

type Translator = ReturnType<typeof useTranslations>;

function previewSubtitle(preview: AiActionPreview, t: Translator) {
  if (isPosCartPreview(preview)) {
    return preview.lines.length
      ? t("ai.preview.posDraftLines", { count: preview.lines.length })
      : t("ai.preview.posDraftEmpty");
  }
  if (preview.missingFields.length > 0) return t("ai.preview.missingInfo");
  return preview.confirmationRequired ? t("ai.preview.pendingConfirmation") : t("ai.preview.preview");
}

function previewBadgeText(preview: AiActionPreview, t: Translator) {
  if (preview.strongConfirmation) return t("ai.preview.strongCheck");
  if (isPosCartPreview(preview)) return t("ai.preview.cartDraft");
  return t("ai.preview.preview");
}

function recordLinkText(record: NonNullable<Msg["record"]>, t: Translator) {
  if (record.type === "pos_cart_draft") return t("ai.preview.openPosDraft", { code: record.code });
  if (record.type === "purchase_order") return t("ai.preview.openPurchaseOrderDraft", { code: record.code });
  return t("ai.preview.openRecord", { code: record.code });
}

function stateText(state: PreviewResolutionState | undefined, t: Translator) {
  if (state === "confirmed") return t("ai.preview.states.confirmed");
  if (state === "succeeded") return t("ai.preview.states.succeeded");
  if (state === "cancelled") return t("ai.preview.states.cancelled");
  if (state === "failed") return t("ai.preview.states.failed");
  return state ?? "";
}

export function PreviewCard({
  preview,
  state,
  result,
  record,
  busy,
  compact,
  onSelectChoice,
}: {
  preview: AiActionPreview;
  state?: PreviewResolutionState;
  result?: string;
  record?: Msg["record"];
  busy: boolean;
  compact?: boolean;
  onSelectChoice: (type: string, candidate: { label: string; code?: string; confidence?: number }) => void;
}) {
  const t = useTranslations();
  const done = state === "confirmed" || state === "succeeded" || state === "cancelled";

  return (
    <div className={cn("w-full bg-surface border border-border rounded-card shadow-e1 overflow-hidden", compact ? "max-w-full" : "max-w-2xl")}>
      <div className="p-3 border-b border-border-soft flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{preview.title}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {previewSubtitle(preview, t)}
          </div>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
          preview.strongConfirmation ? "bg-warn-soft text-warn" : "bg-primary-50 text-primary-700"
        )}>
          {previewBadgeText(preview, t)}
        </span>
      </div>
      <div className="p-3 space-y-3">
        <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
          {preview.fields.map((field) => (
            <div key={field.label} className="rounded-lg bg-canvas border border-border-soft p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{field.label}</div>
              <div className={cn("text-sm font-semibold mt-0.5", field.tone === "warning" && "text-warn", field.tone === "danger" && "text-er")}>{field.value}</div>
            </div>
          ))}
        </div>
        {preview.lines.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            {preview.lines.map((line) => (
              <div key={`${line.label}-${line.value}`} className="flex items-start justify-between gap-3 p-2.5 border-b border-border-soft last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{line.label}</div>
                  {line.meta && <div className="text-[11px] text-slate-400 mt-0.5">{line.meta}</div>}
                </div>
                <div className={cn("text-sm font-mono font-bold shrink-0", line.tone === "danger" ? "text-er" : line.tone === "warning" ? "text-warn" : "text-primary-600")}>{line.value}</div>
              </div>
            ))}
          </div>
        )}
        {preview.missingFields.length > 0 && (
          <div className="rounded-lg bg-warn-soft text-warn p-2.5 text-xs font-semibold">
            {t("ai.preview.missingFields", { fields: preview.missingFields.join(", ") })}
          </div>
        )}
        {preview.warnings.map((warning) => (
          <div key={warning} className="rounded-lg bg-surface-2 p-2.5 text-xs text-slate-500">{warning}</div>
        ))}
        {preview.reviewAction && !done && (
          <a
            href={preview.reviewAction.href}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              storeAiWorkflowDraft(preview);
              if (isPosCartPreview(preview) || preview.intent === "create_order") storePosDraft(preview);
            }}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-bold text-primary-700 transition hover:bg-primary-100 lg:min-h-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {preview.reviewAction.label}
          </a>
        )}
        {preview.selections && preview.selections.length > 0 && (
          <div className="rounded-lg border border-border bg-canvas p-2.5 space-y-2">
            {preview.selections.map((selection) => (
              <div key={`${selection.type}-${selection.query}`} className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-500">
                  {selection.query
                    ? t("ai.preview.chooseSelection", { type: selection.type, query: selection.query })
                    : t("ai.preview.chooseSelectionNoQuery", { type: selection.type })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selection.candidates.map((candidate) => (
                    <Button
                      key={`${candidate.id ?? candidate.label}-${candidate.code ?? ""}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onSelectChoice(selection.type, candidate)}
                      className="h-auto min-h-11 min-w-11 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-surface-2 lg:min-h-0 lg:min-w-0"
                    >
                      {candidate.label}{candidate.code ? ` · ${candidate.code}` : ""}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={cn("p-3 bg-surface-2 border-t border-border flex gap-2", compact ? "flex-col" : "items-center justify-between")}>
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">{result ?? t("ai.preview.noMutationYet")}</div>
          {record && (
            <a href={record.href} className="mt-1 block min-h-11 min-w-11 text-xs font-bold text-primary-600 hover:underline lg:min-h-0 lg:min-w-0">
              {recordLinkText(record, t)}
            </a>
          )}
        </div>
        {done && <span className="text-xs font-bold text-slate-500">{stateText(state, t)}</span>}
      </div>
    </div>
  );
}
