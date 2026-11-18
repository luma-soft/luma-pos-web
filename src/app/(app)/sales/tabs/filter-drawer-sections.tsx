"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, RotateCcw } from "lucide-react";
import { MoneyInput, type MoneyInputProps } from "@/components/ui/money-input";
import { cn } from "@/lib/utils";
import { formatFilterDateRange } from "./filter-mobile-screens";

/**
 * Building blocks shared by the sales filter drawers (orders, returns, quotes,
 * bookings). Desktop keeps the titled-field drawer; phones follow the native
 * filter sheets (NativeInvoiceFilterSheet / NativeReturnsFilterView).
 */

/** Inset hairline between rows of a phone section card. */
const rowSeparators =
  "max-lg:[&>*+*]:bg-[linear-gradient(var(--color-border),var(--color-border))] max-lg:[&>*+*]:bg-[length:calc(100%-16px)_1px] max-lg:[&>*+*]:bg-right-top max-lg:[&>*+*]:bg-no-repeat";

/**
 * Desktop: titled block. Phones: an iOS inset-grouped Form section — grey header
 * and a rounded card whose rows are separated by inset hairlines.
 */
export function FilterSection({
  title,
  mobileTitle,
  children,
}: {
  title: string;
  mobileTitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 max-lg:space-y-2">
      <h3 className="text-sm font-extrabold max-lg:hidden">{title}</h3>
      <h3 className="px-4 text-[15px] font-semibold leading-5 text-ios-label-secondary lg:hidden">{mobileTitle ?? title}</h3>
      <div className={cn("space-y-3 max-lg:space-y-0 max-lg:overflow-hidden max-lg:rounded-[26px] max-lg:bg-surface", rowSeparators)}>
        {children}
      </div>
    </section>
  );
}

/** Min/max amount rows; a grid of fields on desktop, inline rows on phones. */
export function AmountRangeRows({ children }: { children: ReactNode }) {
  return <div className={cn("grid grid-cols-2 gap-3 max-lg:block", rowSeparators)}>{children}</div>;
}

export function LabeledInput({
  label,
  mobileLabel,
  icon,
  suffix,
  ...props
}: MoneyInputProps & {
  label: string;
  /** Phones: LumaLabeledNumberInputField `.inline` — label left, amount right. */
  mobileLabel?: string;
  icon?: ReactNode;
  suffix?: string;
}) {
  return (
    <label className="block rounded-xl border border-border px-3 pb-2 pt-1 focus-within:border-primary-500 focus-within:ring-2 focus-visible:ring-primary-100 max-lg:flex max-lg:min-h-11 max-lg:items-center max-lg:gap-3 max-lg:rounded-none max-lg:border-0 max-lg:px-4 max-lg:py-0 max-lg:focus-within:ring-0">
      <span className="block text-xs text-slate-500 max-lg:hidden">{label}</span>
      {mobileLabel && <span className="shrink-0 text-[17px] text-ios-label lg:hidden">{mobileLabel}</span>}
      <span className="flex items-center gap-2 max-lg:min-w-0 max-lg:flex-1 max-lg:gap-1">
        {icon && <span className="text-slate-500">{icon}</span>}
        <MoneyInput
          {...props}
          className="min-w-0 flex-1 border-0 rounded-none px-0 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 max-lg:text-right max-lg:text-[17px] max-lg:placeholder:text-ios-label-tertiary"
        />
        {suffix && <span className="text-sm font-semibold max-lg:text-[17px] max-lg:font-normal max-lg:text-ios-label-secondary">{suffix}</span>}
      </span>
    </label>
  );
}

export function ChipSection({
  title,
  name,
  value,
  options,
  onChange,
}: {
  title: string;
  name: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange?: (value: string) => void;
}) {
  return (
    <FilterSection title={title}>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer min-h-11 lg:min-h-0 min-w-11 lg:min-w-0">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={(event) => onChange?.(event.currentTarget.value)}
              className="peer sr-only"
            />
            <span className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-xs font-semibold transition hover:border-primary-300 peer-checked:border-primary-600 peer-checked:bg-primary-50 peer-checked:text-primary-700">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </FilterSection>
  );
}

/** iOS LumaSwitch row inside a phone section card. */
export function MobileSwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1.5 lg:hidden">
      <span className="min-w-0 flex-1 text-[17px] text-ios-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        data-button-radius="pill"
        className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors", checked ? "bg-ios-green" : "bg-[rgb(120_120_128/0.16)] dark:bg-[rgb(120_120_128/0.32)]")}
      >
        <span className={cn("absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-[left]", checked ? "left-[22px]" : "left-[2px]")} />
      </button>
    </div>
  );
}

/** Phone row that pushes a date screen; shows the preset and the resolved range. */
export function MobileDateRangeRow({
  label,
  valueLabel,
  from,
  to,
  showRange,
  onOpen,
}: {
  label: string;
  valueLabel?: string;
  from: string;
  to: string;
  showRange: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-3 px-4 py-[11px] text-left active:bg-black/[0.06] dark:active:bg-white/[0.08] lg:hidden"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] text-ios-label">{label}</span>
        {showRange && (from || to) && (
          <span className="mt-0.5 block text-[13px] tabular-nums text-ios-label-secondary">
            {formatFilterDateRange(from, to)}
          </span>
        )}
      </span>
      <span className="max-w-[50%] truncate text-[17px] text-ios-label-secondary">{valueLabel}</span>
      <ChevronRight className="-ml-1.5 size-4 shrink-0 text-ios-label-tertiary" strokeWidth={2.4} aria-hidden="true" />
    </button>
  );
}

/** LumaFilterScreenHeader: Cancel, centred title and selected-condition count (phones only). */
export function MobileFilterHeader({
  title,
  conditionCount,
  onCancel,
}: {
  title: string;
  conditionCount: number;
  onCancel: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="grid shrink-0 grid-cols-[72px_minmax(0,1fr)_72px] items-center gap-2 bg-canvas px-ios-inset pb-3 pt-[calc(0.5rem+env(safe-area-inset-top))] lg:hidden">
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 justify-self-start text-[17px] font-medium text-ios-accent"
      >
        {t("common.cancel")}
      </button>
      <div className="min-w-0 text-center">
        <h2 className="text-[20px] font-semibold leading-[25px]">{title}</h2>
        <p className="mt-[3px] text-[13px] leading-[18px] text-ios-label-secondary">
          {t("mobile.invoices.filters.selectedCount", { count: conditionCount })}
        </p>
      </div>
      <span aria-hidden="true" />
    </div>
  );
}

/**
 * Drawer footer. Desktop: outlined clear + filled apply. Phones: LumaFilterScreenFooter
 * (tinted Clear, hairline divider, filled result button).
 */
export function FilterDrawerFooter({
  onClear,
  invalid,
  pending,
  desktopApplyLabel,
  mobileApplyLabel,
}: {
  onClear: () => void;
  invalid: boolean;
  pending: boolean;
  desktopApplyLabel: string;
  mobileApplyLabel: string;
}) {
  const t = useTranslations();
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-border bg-surface px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] max-lg:flex max-lg:items-center max-lg:gap-3.5 max-lg:border-0 max-lg:px-3 max-lg:pb-[calc(0.5rem+env(safe-area-inset-bottom))] max-lg:pt-3 lg:px-6 lg:py-4 lg:pb-4">
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary-600 font-bold text-primary-700 min-w-11 max-lg:min-h-14 max-lg:min-w-[126px] max-lg:flex-1 max-lg:gap-2 max-lg:rounded-[18px] max-lg:border-0 max-lg:bg-ios-accent/10 max-lg:px-3 max-lg:text-[17px] max-lg:font-semibold max-lg:text-ios-accent lg:min-w-0"
      >
        <RotateCcw className="size-[18px] lg:hidden" strokeWidth={2.4} aria-hidden="true" />
        <span className="lg:hidden">{t("mobile.invoices.filters.clear")}</span>
        <span className="max-lg:hidden">Xóa lọc</span>
      </button>
      <span className="h-[34px] w-px shrink-0 bg-border lg:hidden" aria-hidden="true" />
      <button
        type="submit"
        disabled={invalid}
        aria-busy={pending && !invalid}
        className="min-h-11 rounded-xl bg-primary-600 px-4 font-bold text-white hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 min-w-11 max-lg:min-h-14 max-lg:min-w-[150px] max-lg:flex-1 max-lg:rounded-[18px] max-lg:bg-ios-accent max-lg:px-3 max-lg:text-[16px] max-lg:font-semibold lg:min-w-0"
      >
        <span aria-live="polite">
          <span className="lg:hidden">{mobileApplyLabel}</span>
          <span className="max-lg:hidden">{desktopApplyLabel}</span>
        </span>
      </button>
    </div>
  );
}
