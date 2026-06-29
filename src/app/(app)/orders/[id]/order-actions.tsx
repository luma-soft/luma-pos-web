"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, XCircle } from "lucide-react";
import { addPayment, cancelOrder } from "@/lib/actions/orders";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { MoneyInput } from "@/components/ui/money-input";
import { formatCurrency, cn } from "@/lib/utils";

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
      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-red-200 dark:border-red-900 text-er hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
      {t("orders.detail.cancel")}
    </button>
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

  async function submit() {
    if (amount <= 0 || busy) return;
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
      router.refresh();
    } else {
      setError(t(res.error as never));
    }
  }

  return (
    <div className="bg-surface border border-border rounded-card p-4">
      <h2 className="font-semibold text-sm mb-3">{t("orders.detail.addPayment")}</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">{t("orders.detail.amount")}</label>
          <MoneyInput
            min={0} max={remaining} value={amount}
            onChange={(v) => setAmount(v ?? 0)}
            className="w-40 px-3 py-2 text-sm rounded-lg border border-border bg-surface text-right tabular-nums"
          />
        </div>
        <div className="flex gap-1.5">
          {(["cash", "bank_transfer", "card"] as const).map((m) => (
            <button
              key={m} type="button" onClick={() => setMethod(m)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium border",
                method === m ? "bg-primary-600 text-white border-primary-600" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
              )}
            >
              {t(`pos.payMethods.${m}` as never)}
            </button>
          ))}
        </div>
        <input
          value={reference} onChange={(e) => setReference(e.target.value)}
          placeholder={t("orders.detail.referencePlaceholder")}
          className="w-44 px-3 py-2 text-sm rounded-lg border border-border bg-surface"
        />
        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={t("orders.detail.notePlaceholder")}
          className="flex-1 min-w-40 px-3 py-2 text-sm rounded-lg border border-border bg-surface"
        />
        <button
          onClick={submit} disabled={busy || amount <= 0}
          className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("orders.detail.receive")} {formatCurrency(amount)}
        </button>
      </div>
      {error && <p className="text-xs text-er mt-2">{error}</p>}
    </div>
  );
}
