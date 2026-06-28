"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AiActionPreview } from "@/lib/ai/actions";
import type { Msg, PreviewResolutionState } from "./types";
import { isPosCartPreview } from "./utils";

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

function strongConfirmationText(preview: AiActionPreview, t: Translator) {
  if (preview.intent === "apply_price_formula") return t("ai.preview.strong.applyPriceFormula");
  if (preview.intent === "record_invoice_payment") return t("ai.preview.strong.recordInvoicePayment");
  if (preview.intent === "cancel_invoice") return t("ai.preview.strong.cancelInvoice");
  if (preview.intent === "create_return_refund") return t("ai.preview.strong.createReturnRefund");
  if (preview.intent === "send_einvoice") return t("ai.preview.strong.sendEinvoice");
  if (preview.intent === "create_cashbook_entry") return t("ai.preview.strong.createCashbookEntry");
  if (preview.intent === "convert_quote_to_order") return t("ai.preview.strong.convertQuoteToOrder");
  if (preview.intent === "create_order") return t("ai.preview.strong.createOrder");
  return t("ai.preview.strong.default");
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
  onConfirm,
  onCancel,
  onSelectChoice,
}: {
  preview: AiActionPreview;
  state?: PreviewResolutionState;
  result?: string;
  record?: Msg["record"];
  busy: boolean;
  compact?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onSelectChoice: (type: string, candidate: { label: string; code?: string; confidence?: number }) => void;
}) {
  const t = useTranslations();
  const [strongConfirmation, setStrongConfirmation] = useState<{
    previewId: string;
    state?: PreviewResolutionState;
    checked: boolean;
  }>({ previewId: "", checked: false });
  const strongConfirmed = strongConfirmation.previewId === preview.id && strongConfirmation.state === state
    ? strongConfirmation.checked
    : false;
  const isConfirmed = state === "confirmed";
  const succeeded = state === "succeeded";
  const done = isConfirmed || succeeded || state === "cancelled";
  const canConfirm = preview.state === "preview" && preview.missingFields.length === 0 && (!preview.strongConfirmation || strongConfirmed);

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
        {preview.strongConfirmation && !done && (
          <label className="block rounded-lg border border-warn/25 bg-warn-soft p-2.5 text-xs text-warn">
            <div className="font-bold">{t("ai.preview.strongTitle")}</div>
            <div className="mt-1 leading-relaxed">{strongConfirmationText(preview, t)}</div>
            <div className="mt-2 flex items-start gap-2 font-semibold">
              <input
                type="checkbox"
                checked={strongConfirmed}
                onChange={(event) => setStrongConfirmation({ previewId: preview.id, state, checked: event.target.checked })}
                disabled={busy}
                className="mt-0.5"
              />
              <span>{t("ai.preview.strongAcknowledgement")}</span>
            </div>
          </label>
        )}
        {preview.warnings.map((warning) => (
          <div key={warning} className="rounded-lg bg-surface-2 p-2.5 text-xs text-slate-500">{warning}</div>
        ))}
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
                      className="h-auto rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-surface-2"
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
            <a href={record.href} className="mt-1 block text-xs font-bold text-primary-600 hover:underline">
              {recordLinkText(record, t)}
            </a>
          )}
        </div>
        {done ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-bold", isConfirmed || succeeded ? "text-ok" : "text-slate-500")}>
            {isConfirmed || succeeded ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {stateText(state, t)}
          </span>
        ) : (
          <div className="flex gap-2 justify-end">
            <Button disabled={busy} type="button" variant="outline" size="sm" onClick={onCancel} className="text-xs font-bold text-slate-500">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={busy || !canConfirm}
              type="button"
              size="sm"
              onClick={onConfirm}
              className={cn("text-xs font-bold", preview.strongConfirmation && "bg-warn hover:brightness-95")}
            >
              {preview.strongConfirmation ? t("ai.preview.strongConfirm") : t("common.confirm")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
