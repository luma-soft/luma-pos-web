"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MoneyInput } from "@/components/ui/money-input";
import { createCashTx } from "@/lib/actions/cashbook";

export function CashTxForm() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"in" | "out">("out");
  const [fund, setFund] = useState<"cash" | "bank">("cash");
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState<"expense" | "other" | "debt_collect" | "supplier_payment">("expense");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (amount <= 0 || !note.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await createCashTx({ type, fund, amount, category, note });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setAmount(0); setNote("");
      router.refresh();
    } else setError(t(res.error as never));
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">
        <Plus className="w-4 h-4" />
        {t("cashbook.createTx")}
      </button>
    );
  }

  const inputCls = "px-3 py-2 text-sm rounded-lg border border-border bg-surface";

  return (
    <div className="flex items-end gap-2 bg-surface border border-border rounded-card p-3 flex-wrap">
      <div className="flex gap-1">
        {(["in", "out"] as const).map((tp) => (
          <button key={tp} onClick={() => setType(tp)}
            className={cn("px-3 py-2 rounded-lg text-xs font-medium border",
              type === tp ? (tp === "in" ? "bg-emerald-600 text-white border-emerald-600" : "bg-red-600 text-white border-red-600") : "border-slate-200 dark:border-slate-700 text-slate-600")}>
            {t(`cashbook.typeTabs.${tp}`)}
          </button>
        ))}
      </div>
      <select value={fund} onChange={(e) => setFund(e.target.value as "cash")} className={inputCls}>
        <option value="cash">{t("cashbook.fundCash")}</option>
        <option value="bank">{t("cashbook.fundBank")}</option>
      </select>
      <select value={category} onChange={(e) => setCategory(e.target.value as "expense")} className={inputCls}>
        <option value="expense">{t("cashbook.categories.expense")}</option>
        <option value="debt_collect">{t("cashbook.categories.debt_collect")}</option>
        <option value="supplier_payment">{t("cashbook.categories.supplier_payment")}</option>
        <option value="other">{t("cashbook.categories.other")}</option>
      </select>
      <MoneyInput value={amount || ""} placeholder={t("orders.detail.amount")}
        onChange={(v) => setAmount(v ?? 0)}
        className={cn(inputCls, "w-36 text-right tabular-nums")} />
      <input value={note} placeholder={t("cashbook.notePlaceholder")}
        onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "w-56")} />
      <button onClick={submit} disabled={busy || amount <= 0 || !note.trim()}
        className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("common.save")}
      </button>
      <button onClick={() => setOpen(false)} className="p-2 text-slate-400"><X className="w-4 h-4" /></button>
      {error && <p className="text-xs text-er w-full">{error}</p>}
    </div>
  );
}
