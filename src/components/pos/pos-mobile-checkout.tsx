"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Banknote, Check, ChevronLeft, ChevronRight, FileSearch, Loader2, QrCode, UserRound, type LucideIcon } from "lucide-react";
import { MobileActionSheet } from "@/components/mobile-detail-nav";
import { useHideMobileTabBar } from "@/components/mobile-tabbar-visibility";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

export type PosCheckoutMethod = "cash" | "bank_transfer" | "credit";

type Pricing = {
  heading: string;
  subtotal: number;
  total: number;
  /** Null for returns: only the subtotal and total are shown. */
  adjustments: {
    discountInput: number;
    discountMode: "vnd" | "pct";
    discountAmount: number;
    onDiscountInput: (value: number) => void;
    onDiscountMode: (mode: "vnd" | "pct") => void;
    /** Null when the store does not charge VAT. */
    tax: { rate: number; amount: number; label: string; onRate: (value: number) => void } | null;
    shippingFee: number;
    onShippingFee: (value: number) => void;
  } | null;
};

type Payment = {
  methods: { key: PosCheckoutMethod; label: string }[];
  selected: string;
  onSelect: (method: PosCheckoutMethod) => void;
  /** Sale drafts: what the customer pays now. Null for returns. */
  paid: { value: number; onChange: (value: number) => void; isCredit: boolean; owedNotice: string | null } | null;
};

const METHOD_ICON: Record<PosCheckoutMethod, LucideIcon> = { cash: Banknote, bank_transfer: QrCode, credit: UserRound };
const card = "rounded-[16px] bg-surface p-3.5";
const inputBox = "flex h-[50px] min-w-0 items-center gap-2 rounded-[10px] border border-ios-stroke/60 bg-surface px-3 focus-within:border-ios-accent";
const inputText = "min-w-0 flex-1 border-0 bg-transparent p-0 text-left text-[18px] tabular-nums outline-none placeholder:text-ios-label-tertiary focus:border-transparent focus:ring-0";

/**
 * CheckoutSheet.swift on phones: total card, editable pricing details, method
 * tiles, the amount paid with change / remaining, and a preview + confirm footer.
 */
export function PosMobileCheckout({
  title,
  subtitle,
  onBack,
  pricing,
  payment,
  notice,
  extras,
  printTemplates,
  printTemplateId,
  onPrintTemplate,
  error,
  onPrint,
  printDisabled,
  confirmLabel,
  confirmDisabled,
  submitting,
  onConfirm,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  pricing: Pricing;
  payment: Payment | null;
  notice?: ReactNode;
  /** Web-only fields (project, delivery time, hold…) kept below the native sections. */
  extras?: ReactNode;
  printTemplates: { id: string; name: string }[];
  printTemplateId: string;
  onPrintTemplate: (id: string) => void;
  error?: ReactNode;
  onPrint: () => void;
  printDisabled: boolean;
  confirmLabel: string;
  confirmDisabled: boolean;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("mobile.checkout");
  const tc = useTranslations();
  useHideMobileTabBar();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const { adjustments, total } = pricing;
  const template = printTemplates.find((item) => item.id === printTemplateId);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[70] flex flex-col bg-canvas lg:hidden print:hidden">
      <header className="grid shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button
          type="button"
          onClick={onBack}
          aria-label={tc("common.back")}
          data-button-radius="pill"
          className="grid size-11 place-items-center rounded-full border border-black/[0.06] bg-surface/90 text-ios-accent shadow-[0_2px_10px_rgb(0_0_0/0.08)] dark:border-white/10"
        >
          <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
        </button>
        <div className="min-w-0 text-center">
          <h1 className="truncate text-[17px] font-semibold leading-[22px]">{title}</h1>
          <p className="truncate text-[13px] text-ios-label-secondary">{subtitle}</p>
        </div>
        <span aria-hidden="true" />
      </header>

      <div className="min-h-0 flex-1 space-y-ios-section overflow-y-auto overscroll-contain px-ios-inset py-4">
        <section className="rounded-[16px] border border-ios-accent/20 bg-ios-accent/10 p-4 text-center text-ios-accent">
          <div className="text-[15px] font-extrabold">{t(adjustments ? "total" : "refundTotal")}</div>
          <div className="mt-1 text-[30px] font-black leading-9 tabular-nums">{formatCurrency(total)}</div>
        </section>

        <section className={card}>
          <h2 className="text-[13px] font-extrabold uppercase text-ios-label-tertiary">{pricing.heading}</h2>
          <SummaryRow className="mt-2.5" label={t("subtotal")} value={formatCurrency(pricing.subtotal)} />
          {adjustments && (
            <>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <div className="grid h-[50px] grid-cols-2 rounded-full bg-ios-accent/10 p-1" role="radiogroup" aria-label={t("discountType")}>
                  {(["pct", "vnd"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={adjustments.discountMode === mode}
                      onClick={() => adjustments.discountMode !== mode && adjustments.onDiscountMode(mode)}
                      data-button-radius="pill"
                      className={cn("rounded-full text-[15px] font-medium", adjustments.discountMode === mode ? "bg-ios-accent text-white" : "text-ios-label")}
                    >
                      {mode === "pct" ? "%" : "₫"}
                    </button>
                  ))}
                </div>
                <AmountBox
                  label={t("discountValue")}
                  mode={adjustments.discountMode}
                  value={adjustments.discountInput}
                  onChange={adjustments.onDiscountInput}
                />
              </div>
              <div className={cn("mt-2.5 grid gap-2.5", adjustments.tax && "grid-cols-2")}>
                {adjustments.tax && <AmountBox label={t("vatRate")} mode="pct" value={adjustments.tax.rate} onChange={adjustments.tax.onRate} />}
                <AmountBox label={t("shippingFee")} mode="vnd" value={adjustments.shippingFee} onChange={adjustments.onShippingFee} />
              </div>
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                <SummaryRow label={t("discount")} value={`-${formatCurrency(adjustments.discountAmount)}`} className="text-ios-green" />
                {adjustments.tax && <SummaryRow label={adjustments.tax.label} value={formatCurrency(adjustments.tax.amount)} />}
                <SummaryRow label={t("shipping")} value={formatCurrency(adjustments.shippingFee)} />
              </div>
            </>
          )}
          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border pt-3 text-[17px] font-bold text-ios-accent">
            <span>{t(adjustments ? "total" : "refundTotal")}</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
        </section>

        {notice && <div className={cn(card, "text-[15px] text-ios-label-secondary")}>{notice}</div>}

        {payment && (
          <section className={card}>
            <h2 className="text-[17px] font-semibold">{t("method")}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2.5" role="radiogroup" aria-label={t("method")}>
              {payment.methods.map(({ key, label }) => {
                const Icon = METHOD_ICON[key];
                const selected = payment.selected === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => payment.onSelect(key)}
                    className={cn(
                      "flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-1.5 !rounded-[13px] border px-0.5 text-[14px] font-semibold tracking-tight",
                      selected ? "border-ios-accent bg-ios-accent text-white" : "border-border bg-surface text-ios-label",
                    )}
                  >
                    <Icon className="size-6" strokeWidth={2} aria-hidden="true" />
                    <span className="max-w-full truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {payment?.paid && <PaidSection total={total} paid={payment.paid} />}

        <section className={cn(card, "space-y-3")}>
          {extras}
          <button type="button" onClick={() => setTemplatesOpen(true)} className="flex min-h-11 w-full items-center gap-2 text-left text-[17px]">
            <span className="min-w-0 flex-1 truncate">{tc("pos.printTemplate")}</span>
            <span className="max-w-[50%] truncate text-ios-label-secondary">{template?.name}</span>
            <ChevronRight className="size-[17px] shrink-0 text-ios-label-tertiary" strokeWidth={2.5} aria-hidden="true" />
          </button>
        </section>
      </div>

      <footer className="shrink-0 border-t border-border bg-surface px-ios-inset pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
        {error && <div role="alert" className="pb-2 text-[13px] text-ios-red">{error}</div>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPrint}
            disabled={printDisabled}
            aria-label={tc("pos.printSlip")}
            className="grid h-[54px] w-[62px] shrink-0 place-items-center !rounded-[14px] border border-border bg-surface text-ios-accent disabled:opacity-50"
          >
            <FileSearch className="size-[22px]" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="flex h-[54px] min-w-0 flex-1 items-center justify-center gap-2 !rounded-[14px] bg-ios-accent px-3 text-[17px] font-semibold text-white disabled:bg-black/[0.06] disabled:text-ios-label-secondary dark:disabled:bg-white/10"
          >
            {submitting && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
            <span className="truncate">{confirmLabel}</span>
          </button>
        </div>
      </footer>

      <MobileActionSheet open={templatesOpen} onClose={() => setTemplatesOpen(false)} title={tc("pos.printTemplate")}>
        {printTemplates.map((item) => (
          <button
            key={item.id}
            type="button"
            data-menu-action
            onClick={() => onPrintTemplate(item.id)}
            className="flex h-12 w-full items-center gap-3 rounded-[14px] bg-surface px-4 text-left text-[17px]"
          >
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {item.id === printTemplateId && <Check className="size-5 text-ios-accent" aria-hidden="true" />}
          </button>
        ))}
      </MobileActionSheet>
    </div>
  );
}

function PaidSection({ total, paid }: { total: number; paid: NonNullable<Payment["paid"]> }) {
  const t = useTranslations("mobile.checkout");
  const amount = paid.isCredit ? 0 : paid.value;
  const settled = !paid.isCredit && amount >= total && amount > 0;
  return (
    <section className={cn(card, "space-y-2.5")}>
      <h2 className="text-[15px] text-ios-label-secondary">{t("received")}</h2>
      {paid.isCredit ? (
        <p className="rounded-[14px] border border-ios-orange/25 bg-ios-orange/10 p-3 text-[15px] font-semibold text-ios-orange">{t("fullDebtNotice")}</p>
      ) : (
        <div className={inputBox}>
          <MoneyInput value={paid.value} onChange={(value) => paid.onChange(value ?? 0)} placeholder="0" aria-label={t("received")} className={inputText} />
          <span className="text-[15px] text-ios-label-secondary" aria-hidden="true">đ</span>
        </div>
      )}
      <div className={cn(
        "flex items-center justify-between gap-3 rounded-[14px] border p-3 text-[15px] font-bold",
        settled ? "border-ios-green/25 bg-ios-green/10 text-ios-green" : "border-border bg-canvas text-ios-label-secondary",
      )}>
        <span>{t(settled ? "change" : "remaining")}</span>
        <span className={cn("text-[18px] font-black tabular-nums", !settled && "text-ios-label")}>{formatCurrency(Math.abs(total - amount))}</span>
      </div>
      {paid.owedNotice && <p className="text-[13px] text-ios-orange">{paid.owedNotice}</p>}
    </section>
  );
}

function SummaryRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-[15px] text-ios-label-secondary", className)}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** iOS prompt-style field: the label is the placeholder while the value is zero. */
function AmountBox({ label, mode, value, onChange }: { label: string; mode: "vnd" | "pct"; value: number; onChange: (value: number) => void }) {
  return (
    <div className={inputBox}>
      {mode === "pct" ? (
        <NumberInput min={0} max={100} decimals={4} value={value || null} onChange={(next) => onChange(next ?? 0)} thousandSeparator={false} placeholder={label} aria-label={label} title={formatNumber(value)} className={inputText} />
      ) : (
        <MoneyInput value={value || ""} onChange={(next) => onChange(next ?? 0)} placeholder={label} aria-label={label} className={inputText} />
      )}
      <span className="shrink-0 text-[15px] text-ios-label-secondary" aria-hidden="true">{mode === "pct" ? "%" : "đ"}</span>
    </div>
  );
}
