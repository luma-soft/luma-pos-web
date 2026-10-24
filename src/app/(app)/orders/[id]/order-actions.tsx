"use client";

import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CreditCard, Loader2, MessageCircle, X, XCircle } from "lucide-react";
import { addPayment, cancelOrder } from "@/lib/actions/orders";
import { sendOrderInvoiceZalo } from "@/lib/actions/zalo";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { MoneyInput } from "@/components/ui/money-input";
import { formatCurrency, cn } from "@/lib/utils";
import { Routes } from "@/lib/routes";
import { buttonVariants, modalActionSizeClassName } from "@/components/ui/button-variants";

export function OrderActions({ orderId }: { orderId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  async function onCancel() {
    if (busy) return;
    const ok = await dialog.confirm({
      description: t("orders.detail.cancelConfirm"),
      confirmLabel: t("orders.detail.cancel"),
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    const res = await cancelOrder(orderId);
    setBusy(false);
    if (res.ok) router.refresh();
    else await dialog.alert({ description: t(res.error as never), variant: "destructive" });
  }

  return (
    <button
      onClick={onCancel}
      disabled={busy}
      className={cn("inline-flex min-w-11 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-er hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40 disabled:opacity-50 lg:min-w-0", modalActionSizeClassName)}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
      {t("orders.detail.cancel")}
    </button>
  );
}

export function SendOrderZaloButton({ orderId }: { orderId: string }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function send() {
    if (busy) return;
    setBusy(true);
    setStatus("");
    const url = typeof window === "undefined" ? undefined : `${window.location.origin}${Routes.salesOrder(orderId, "completed")}`;
    const res = await sendOrderInvoiceZalo({ orderId, url });
    setBusy(false);
    setStatus(res.ok ? t("zalo.sent") : t(res.error as never));
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={send}
        disabled={busy}
        className={cn("inline-flex min-w-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2 disabled:opacity-50 lg:min-w-0", modalActionSizeClassName)}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
        {t("zalo.send")}
      </button>
      {status && <span className="text-xs text-slate-500">{status}</span>}
    </div>
  );
}

export function PaymentForm({ orderId, remaining }: { orderId: string; remaining: number }) {
  const t = useTranslations();
  const router = useRouter();
  const [amount, setAmount] = useState(remaining);
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "card">("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialog?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  async function submit() {
    if (amount <= 0 || amount > remaining || busy) return;
    setBusy(true);
    setError("");
    const res = await addPayment({
      orderId,
      amount,
      method,
      reference: reference || undefined,
      note: note || undefined,
    });
    setBusy(false);
    if (res.ok) {
      setReference("");
      setNote("");
      setOpen(false);
      router.refresh();
    } else {
      setError(t(res.error as never));
    }
  }

  function onBackdropMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.target === event.currentTarget) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), modalActionSizeClassName, "bg-white dark:bg-surface")}
      >
        <CreditCard className="h-4 w-4" />
        {t("orders.detail.paymentAction")}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
          onMouseDown={onBackdropMouseDown}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-payment-title"
            tabIndex={-1}
            className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl outline-none sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-soft px-4 py-3 sm:px-5">
              <h2 id="order-payment-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t("orders.detail.addPayment")}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3">
                <span className="text-sm text-slate-500">{t("orders.detail.remaining")}</span>
                <strong className="text-base tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(remaining)}</strong>
              </div>

              <label className="block space-y-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
                {t("orders.detail.amount")}
                <MoneyInput
                  min={0}
                  max={remaining}
                  value={amount}
                  suffix="đ"
                  onChange={(value) => setAmount(value ?? 0)}
                  className="h-12 rounded-xl border border-border bg-surface px-3 text-right text-lg font-semibold tabular-nums outline-none focus:border-primary-600"
                />
              </label>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">{t("orders.detail.paymentMethod")}</div>
                <div role="group" aria-label={t("orders.detail.paymentMethod")} className="grid grid-cols-3 gap-2">
                  {(["cash", "bank_transfer", "card"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={method === option}
                      onClick={() => setMethod(option)}
                      className={cn(
                        "min-h-11 rounded-xl border px-3 text-sm font-semibold transition",
                        method === option
                          ? "border-primary-600 bg-primary-600 text-white"
                          : "border-border bg-surface text-slate-600 hover:bg-surface-2 dark:text-slate-300",
                      )}
                    >
                      {t(`pos.payMethods.${option}` as never)}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
                {t("orders.detail.referenceLabel")}
                <input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder={t("orders.detail.referencePlaceholder")}
                  className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-normal text-slate-900 outline-none focus:border-primary-600 dark:text-slate-100"
                />
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
                {t("orders.detail.noteLabel")}
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("orders.detail.notePlaceholder")}
                  rows={3}
                  className="min-h-20 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-primary-600 dark:text-slate-100"
                />
              </label>
              {error && <p role="alert" className="text-sm text-er">{error}</p>}
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-border-soft px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold text-slate-600 transition hover:bg-surface-2 disabled:opacity-50 dark:text-slate-300"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || amount <= 0 || amount > remaining}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("orders.detail.receive")} {formatCurrency(amount)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
