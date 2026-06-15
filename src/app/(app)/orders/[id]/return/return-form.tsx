"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { createReturn } from "@/lib/actions/returns";

interface ReturnableItem {
  orderItemId: string;
  productName: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  returned: number;
}

interface Props {
  orderId: string;
  orderCode: string;
  customerName: string | null;
  customerDebt: number;
  hasCustomer: boolean;
  items: ReturnableItem[];
}

type RefundMethod = "cash" | "bank_transfer" | "debt_deduct";

export function ReturnForm({ orderId, orderCode, customerName, customerDebt, hasCustomer, items }: Props) {
  const t = useTranslations();
  const router = useRouter();

  const [qty, setQtyMap] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((i) => [i.orderItemId, true]))
  );
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<RefundMethod>(
    hasCustomer && customerDebt > 0 ? "debt_deduct" : "cash"
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const totalRefund = items.reduce((s, i) => s + (qty[i.orderItemId] ?? 0) * i.unitPrice, 0);
  const selected = items.filter((i) => (qty[i.orderItemId] ?? 0) > 0);
  const debtTooSmall = refundMethod === "debt_deduct" && totalRefund > customerDebt;

  function setQty(id: string, v: number, max: number) {
    setQtyMap((m) => ({ ...m, [id]: Math.max(0, Math.min(max, v)) }));
  }

  async function submit() {
    if (selected.length === 0 || !reason.trim() || busy || debtTooSmall) return;
    setBusy(true);
    setError("");
    const res = await createReturn({
      orderId,
      reason,
      refundMethod,
      note: note || undefined,
      items: selected.map((i) => ({
        orderItemId: i.orderItemId,
        quantity: qty[i.orderItemId],
        restock: restock[i.orderItemId] ?? true,
      })),
    });
    setBusy(false);
    if (res.ok) router.push(Routes.order(orderId));
    else setError(t(res.error as never));
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(Routes.order(orderId))} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-2xl font-bold">{t("returns.titleFor", { code: orderCode })}</h1>
      </div>

      <div className="bg-surface border border-border rounded-card overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-3 font-semibold">{t("orders.cols.product")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("returns.cols.bought")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("returns.cols.returned")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("returns.cols.returnNow")}</th>
              <th className="px-4 py-3 font-semibold">{t("returns.cols.restock")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("returns.cols.refund")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {items.map((i) => {
              const max = i.quantity - i.returned;
              const q = qty[i.orderItemId] ?? 0;
              return (
                <tr key={i.orderItemId} className={cn(max <= 0 && "opacity-50")}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{i.productName}</div>
                    <div className="text-xs text-slate-400">{formatCurrency(i.unitPrice)}/{i.unitName}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(i.quantity)} {i.unitName}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{i.returned > 0 ? formatNumber(i.returned) : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number" min={0} max={max} value={q}
                      disabled={max <= 0}
                      onChange={(e) => setQty(i.orderItemId, Number(e.target.value), max)}
                      className="w-24 px-2 py-1.5 text-right text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-surface tabular-nums disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={restock[i.orderItemId] ? "1" : "0"}
                      onChange={(e) => setRestock((m) => ({ ...m, [i.orderItemId]: e.target.value === "1" }))}
                      disabled={q <= 0}
                      className="px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-surface disabled:opacity-50"
                    >
                      <option value="1">{t("returns.restockYes")}</option>
                      <option value="0">{t("returns.restockNo")}</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-er">
                    {q > 0 ? `− ${formatCurrency(q * i.unitPrice)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-surface border border-border rounded-card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("returns.reason")} *</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface">
              <option value="">{t("returns.pickReason")}</option>
              <option value="defective">{t("returns.reasons.defective")}</option>
              <option value="wrong_item">{t("returns.reasons.wrong_item")}</option>
              <option value="changed_mind">{t("returns.reasons.changed_mind")}</option>
              <option value="other">{t("returns.reasons.other")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("returns.refundVia")}</label>
            <div className="flex gap-1.5">
              {(["debt_deduct", "cash", "bank_transfer"] as RefundMethod[]).map((m) => {
                const disabled = m === "debt_deduct" && (!hasCustomer || customerDebt <= 0);
                return (
                  <button
                    key={m} type="button" disabled={disabled}
                    onClick={() => setRefundMethod(m)}
                    className={cn(
                      "px-3 py-2 rounded-lg text-xs font-medium border disabled:opacity-40",
                      refundMethod === m ? "bg-primary-600 text-white border-primary-600" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {t(`returns.refundMethods.${m}`)}
                  </button>
                );
              })}
            </div>
            {refundMethod === "debt_deduct" && (
              <p className={cn("text-xs mt-1", debtTooSmall ? "text-er" : "text-slate-400")}>
                {t("returns.currentDebtOf", { name: customerName ?? "", debt: formatCurrency(customerDebt) })}
              </p>
            )}
          </div>
        </div>

        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={t("orders.detail.notePlaceholder")}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface"
        />

        {error && <p className="text-sm text-er">{error}</p>}
        {debtTooSmall && <p className="text-sm text-er">{t("returns.errors.debtTooSmall")}</p>}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="text-sm">
            <span className="text-slate-500">{t("returns.totalRefund")}: </span>
            <b className="text-er tabular-nums text-base">{formatCurrency(totalRefund)}</b>
          </div>
          <button
            onClick={submit}
            disabled={busy || selected.length === 0 || !reason || debtTooSmall}
            className="px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            {t("returns.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
