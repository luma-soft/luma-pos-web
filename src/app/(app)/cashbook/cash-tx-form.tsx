"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { createCashTx } from "@/lib/actions/cashbook";

export function CashTxForm() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"in" | "out">("out");
  const [fund, setFund] = useState<"cash" | "bank">("cash");
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState<"expense" | "other" | "debt_collect" | "supplier_payment">("expense");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (amount <= 0 || !note.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await createCashTx({ type, fund, amount, category, counterparty, note });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setAmount(0); setCounterparty(""); setNote("");
      router.refresh();
    } else setError(t(res.error as never));
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} tx="cashbook.createTx">
        <Plus className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <div className="flex items-end gap-2 bg-surface border border-border rounded-card p-3 flex-wrap">
      <div className="flex gap-1">
        {(["in", "out"] as const).map((tp) => (
          <Button
            key={tp}
            type="button"
            variant={type === tp ? (tp === "in" ? "success" : "destructive") : "outline"}
            size="sm"
            onClick={() => setType(tp)}
            tx={`cashbook.typeTabs.${tp}`}
          />
        ))}
      </div>
      <Select
        value={fund}
        onChange={(e) => setFund(e.target.value as "cash" | "bank")}
        options={[
          { value: "cash", label: t("cashbook.fundCash") },
          { value: "bank", label: t("cashbook.fundBank") },
        ]}
      />
      <Select
        value={category}
        onChange={(e) => setCategory(e.target.value as "expense" | "other" | "debt_collect" | "supplier_payment")}
        options={[
          { value: "expense", label: t("cashbook.categories.expense") },
          { value: "debt_collect", label: t("cashbook.categories.debt_collect") },
          { value: "supplier_payment", label: t("cashbook.categories.supplier_payment") },
          { value: "other", label: t("cashbook.categories.other") },
        ]}
      />
      <MoneyInput value={amount || ""} placeholder={t("orders.detail.amount")}
        onChange={(v) => setAmount(v ?? 0)}
        className="w-36 text-right tabular-nums" />
      <Input value={counterparty} placeholder={type === "in" ? t("cashbook.payerPlaceholder") : t("cashbook.recipientPlaceholder")}
        onChange={(e) => setCounterparty(e.target.value)} className="w-48" />
      <Input value={note} placeholder={t("cashbook.notePlaceholder")}
        onChange={(e) => setNote(e.target.value)} className="w-56" />
      <Button type="button" onClick={submit} disabled={busy || amount <= 0 || !note.trim()} loading={busy} tx="common.save" />
      <Button type="button" variant="ghost" size="iconSm" onClick={() => setOpen(false)}><X className="w-4 h-4" /></Button>
      {error && <Text as="p" variant="destructive" size="xs" className="w-full" text={error} />}
    </div>
  );
}
