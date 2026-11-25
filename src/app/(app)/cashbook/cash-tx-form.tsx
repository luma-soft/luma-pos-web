"use client";

import { DocumentTimeField, documentTimePayload } from "@/components/document-time-field";
import { useState, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { createCashTx } from "@/lib/actions/cashbook";
import { createPortal } from "react-dom";
import { usePhoneLayout } from "@/components/use-phone-layout";
import { useHideMobileTabBar } from "@/components/mobile-tabbar-visibility";
import { MobileFormHeader } from "@/components/mobile-form-header";
import { MobileGroupedSection } from "@/components/mobile-pushed-screen";
import { LumaWebPicker } from "@/app/(app)/sales/tabs/filter-drawer-shared";
import { cn } from "@/lib/utils";
import { useModalLayer } from "@/components/ui/use-modal-layer";

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
  const [occurredAt, setOccurredAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const phone = usePhoneLayout();

  async function submit() {
    if (amount <= 0 || !note.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await createCashTx({ type, fund, amount, category, counterparty, note, occurredAt: documentTimePayload(occurredAt) });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setAmount(0); setCounterparty(""); setNote(""); setOccurredAt("");
      router.refresh();
    } else setError(t(res.error as never));
  }

  if (phone) {
    const segmented = <V extends string>(value: V, options: Array<[V, string]>, onChange: (v: V) => void) => (
      <div className="grid grid-cols-2 rounded-full bg-ios-accent/10 p-1">
        {options.map(([key, label]) => (
          <button key={key} type="button" onClick={() => onChange(key)} data-button-radius="pill"
            className={cn("min-h-9 rounded-full text-[15px]", value === key ? "bg-ios-accent font-semibold text-white" : "text-ios-label")}>{label}</button>
        ))}
      </div>
    );
    return (
      <>
        {/* Phones: the full-width "Tạo phiếu thu chi" button of CashbookView. */}
        <button type="button" onClick={() => setOpen(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-ios-accent text-[17px] font-medium text-white active:opacity-80">
          <Plus className="size-5" aria-hidden="true" />{t("mobile.finance.createEntry")}
        </button>
        {open && createPortal(
          <PhoneSheet onClose={() => setOpen(false)}>
            <MobileFormHeader title={t("mobile.finance.createEntry")} onCancel={() => setOpen(false)} submitLabel={t("common.save")} onSubmit={() => void submit()} submitting={busy} />
            <div className="space-y-ios-section px-ios-inset pb-10 pt-2">
              <MobileGroupedSection>
                <div className="space-y-3 px-4 py-3">
                  {segmented(type, [["in", t("mobile.finance.in")], ["out", t("mobile.finance.out")]], setType)}
                  {segmented(fund, [["cash", t("mobile.finance.cash")], ["bank", t("mobile.finance.bank")]], setFund)}
                </div>
                <LumaWebPicker name="category" ariaLabel={t("mobile.finance.category")} rowLabel={t("mobile.finance.category")} value={category}
                  options={(["expense", "debt_collect", "supplier_payment", "other"] as const).map((key) => ({ value: key, label: t(`mobile.finance.cat.${key}`) }))}
                  onChange={(value) => setCategory(value as typeof category)} />
              </MobileGroupedSection>
              <MobileGroupedSection title={t("mobile.finance.entryDetails")}>
                <label className="flex min-h-11 items-center gap-3 px-4 py-1.5 text-[17px]">
                  <span className="shrink-0">{t("mobile.finance.amount")}</span>
                  <MoneyInput value={amount || ""} onChange={(v) => setAmount(v ?? 0)} placeholder="0" className="min-w-0 flex-1 border-0 bg-transparent px-0 text-right text-[17px] shadow-none focus:ring-0" />
                </label>
                <label className="block px-4 py-2">
                  <span className="block text-[13px] text-ios-label-secondary">{type === "in" ? t("mobile.finance.payer") : t("mobile.finance.recipient")}</span>
                  <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} className="mt-1 w-full bg-transparent text-[17px] outline-none" />
                </label>
                <label className="block px-4 py-2">
                  <span className="block text-[13px] text-ios-label-secondary">{t("mobile.finance.note")}</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full resize-none bg-transparent text-[17px] outline-none" />
                </label>
                <DocumentTimeField className="px-4 py-2" label={t("documentTime.cash")} value={occurredAt} onChange={setOccurredAt} />
              </MobileGroupedSection>
              {error && <p className="px-4 text-[13px] text-ios-red">{error}</p>}
            </div>
          </PhoneSheet>,
          document.body,
        )}
      </>
    );
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
      <DocumentTimeField className="w-56" label={t("documentTime.cash")} value={occurredAt} onChange={setOccurredAt} />
      <Button type="button" onClick={submit} disabled={busy || amount <= 0 || !note.trim()} loading={busy} tx="common.save" />
      <Button type="button" variant="ghost" size="iconSm" onClick={() => setOpen(false)}><X className="w-4 h-4" /></Button>
      {error && <Text as="p" variant="destructive" size="xs" className="w-full" text={error} />}
    </div>
  );
}

/** Full-screen phone form that also hides the tab bar while open. */
function PhoneSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalLayer({ onEscape: onClose, elementRef: sheetRef });
  useHideMobileTabBar();
  return <div ref={sheetRef} role="dialog" aria-modal="true" className="fixed inset-0 z-[110] overflow-y-auto bg-canvas lg:hidden">{children}</div>;
}
