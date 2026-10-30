"use client";

import { useState, useTransition } from "react";
import { Ban, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cancelCashTx } from "@/lib/actions/cashbook";
import { cancelSupplierPayable } from "@/lib/actions/payables";
import { cancelCustomerReceivable } from "@/lib/actions/receivables";
import { formatCurrency } from "@/lib/utils";

type VoucherProps = {
  code: string;
  amount: number;
  onCancelled?: () => void | Promise<void>;
} & (
  | { kind: "customer"; receiptId: string; partyId: string }
  | { kind: "supplier"; receiptId: string; partyId: string }
  | { kind: "cashbook"; transactionId: string }
);

export function CancelFinancialVoucherButton(props: VoucherProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setReason("");
    setError("");
  }

  function submit() {
    if (reason.trim().length < 3 || pending) return;
    setError("");
    startTransition(async () => {
      const result = props.kind === "customer"
        ? await cancelCustomerReceivable({ customerId: props.partyId, receiptId: props.receiptId, reason: reason.trim() })
        : props.kind === "supplier"
          ? await cancelSupplierPayable({ supplierId: props.partyId, receiptId: props.receiptId, reason: reason.trim() })
          : await cancelCashTx({ transactionId: props.transactionId, reason: reason.trim() });

      if (!result.ok) {
        setError(t.has(result.error) ? t(result.error as never) : t("financialVoucherCancellation.failed"));
        return;
      }

      setOpen(false);
      setReason("");
      await props.onCancelled?.();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-200 px-2.5 text-xs font-semibold text-er hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-900 dark:hover:bg-red-950/30"
      >
        <Ban className="h-3.5 w-3.5" />
        {t("financialVoucherCancellation.cancelAction")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:items-center sm:p-5"
          role="presentation"
          onMouseDown={close}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-financial-voucher-title"
            className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-card bg-surface p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="cancel-financial-voucher-title" className="text-lg font-bold">
                  {t("financialVoucherCancellation.title", { code: props.code })}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t("financialVoucherCancellation.amount")}: {formatCurrency(props.amount)}
                </p>
              </div>
              <button
                type="button"
                aria-label={t("common.close")}
                disabled={pending}
                onClick={close}
                className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-surface-2 disabled:opacity-50 lg:min-h-9 lg:min-w-9"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {t("financialVoucherCancellation.warning")}
            </div>

            <label className="block text-sm font-medium" htmlFor="financial-voucher-cancel-reason">
              {t("financialVoucherCancellation.reasonLabel")}
              <textarea
                id="financial-voucher-cancel-reason"
                value={reason}
                maxLength={500}
                minLength={3}
                required
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("financialVoucherCancellation.reasonPlaceholder")}
                className="mt-1 min-h-24 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
              />
              <span className="mt-1 block text-right text-xs text-slate-400">{reason.length}/500</span>
            </label>

            {error && <p role="alert" className="mt-3 text-sm font-medium text-er">{error}</p>}

            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border-soft pt-4">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-primary-700 hover:bg-surface-2 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || reason.trim().length < 3}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {pending ? t("financialVoucherCancellation.working") : t("financialVoucherCancellation.confirm")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
