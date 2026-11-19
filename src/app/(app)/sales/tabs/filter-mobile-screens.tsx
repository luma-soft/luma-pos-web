"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleX, FileText, ListFilter, Package, Search } from "lucide-react";
import { isOrderDateRangeValid } from "@/lib/orders/filter-date-range";
import { cn } from "@/lib/utils";
import type { EntityPickerKind, EntityPickerOption, PickerOption } from "./filter-drawer-shared";

/**
 * Full-screen pushed screen used by phone filters (LumaProductSelectionHeader on
 * the grouped background), rendered above the filter sheet.
 */
function MobileFilterScreen({
  title,
  subtitle,
  onBack,
  toolbar,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onBack();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onBack]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[130] flex flex-col bg-canvas pt-[env(safe-area-inset-top)] lg:hidden"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-3 bg-surface px-ios-inset pb-1 pt-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("common.back")}
          data-button-radius="pill"
          className="grid size-[52px] shrink-0 place-items-center rounded-[14px] border border-ios-stroke/50 bg-surface text-ios-label"
        >
          <ChevronLeft className="size-[22px]" strokeWidth={2.6} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-extrabold leading-[22px]">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-[12px] leading-4 text-ios-label-secondary">{subtitle}</div>}
        </div>
      </div>
      {toolbar}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {footer}
    </div>,
    document.body,
  );
}

/** NativeInvoiceFilterPickerView: search bar, "All" row and 76pt choice rows. */
export function MobileEntityPickerScreen({
  kind,
  title,
  searchPrompt,
  query,
  onQueryChange,
  options,
  loading,
  error,
  value,
  labelValue,
  onPick,
  onClear,
  onClose,
}: {
  kind: EntityPickerKind;
  title: string;
  searchPrompt: string;
  query: string;
  onQueryChange: (query: string) => void;
  options: EntityPickerOption[];
  loading: boolean;
  error: string;
  value: string;
  labelValue: string;
  onPick: (option: EntityPickerOption) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  const noneSelected = !value && !labelValue;

  return (
    <MobileFilterScreen
      title={title}
      subtitle={searchPrompt}
      onBack={onClose}
      toolbar={(
        <div className="border-b border-border bg-surface px-ios-inset py-ios-search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ios-label-secondary" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={searchPrompt}
              aria-label={searchPrompt}
              className="h-[52px] w-full rounded-[15px] border border-ios-stroke/50 bg-canvas pl-[42px] pr-11 text-[17px] outline-none placeholder:text-ios-label-secondary focus:!border-ios-stroke/50 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onQueryChange("");
                  inputRef.current?.focus({ preventScroll: true });
                }}
                aria-label={t("common.clear")}
                className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center"
              >
                <CircleX className="size-[18px] fill-ios-label-tertiary text-surface" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    >
      <button
        type="button"
        onClick={() => {
          onClear();
          onClose();
        }}
        className="relative flex min-h-14 w-full items-center gap-3 px-ios-inset text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
      >
        <span className="grid w-10 place-items-center text-ios-accent"><ListFilter className="size-[22px]" strokeWidth={2.2} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1 text-[17px] font-semibold">{t("mobile.invoices.filters.anyValue")}</span>
        {noneSelected && <CheckCircle2 className="size-[22px] fill-ios-accent text-surface" aria-hidden="true" />}
        <span className="absolute bottom-0 inset-x-0 h-px bg-border" aria-hidden="true" />
      </button>

      {loading && options.length === 0 ? (
        Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="relative flex min-h-[76px] items-center gap-3 px-3.5" aria-hidden="true">
            <span className="size-10 shrink-0 rounded-[12px] bg-black/[0.08] dark:bg-white/[0.08]" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block h-3.5 rounded-full bg-black/[0.08] dark:bg-white/[0.08]" style={{ width: index % 2 ? 150 : 190 }} />
              <span className="block h-2.5 w-24 rounded-full bg-black/[0.08] dark:bg-white/[0.08]" />
            </span>
            <span className="absolute bottom-0 inset-x-0 h-px bg-border" />
          </div>
        ))
      ) : error && options.length === 0 ? (
        <p className="px-ios-inset py-10 text-center text-[15px] text-ios-label-secondary">{t("mobile.invoices.filters.pickerError")}</p>
      ) : options.length === 0 ? (
        <p className="px-ios-inset py-10 text-center text-[15px] text-ios-label-secondary">{t("mobile.invoices.filters.pickerEmpty")}</p>
      ) : (
        <div role="listbox" aria-label={title}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onPick(option);
                  onClose();
                }}
                className={cn(
                  "relative flex min-h-[76px] w-full items-center gap-3 px-3.5 text-left",
                  selected ? "bg-ios-accent/[0.08] dark:bg-ios-accent/[0.16]" : "active:bg-black/[0.04] dark:active:bg-white/[0.06]",
                )}
              >
                <ChoiceThumbnail kind={kind} option={option} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[15px] font-bold leading-5">{option.label}</span>
                  {option.hint && <span className="mt-1 block truncate text-[12px] leading-4 text-ios-label-secondary">{option.hint}</span>}
                </span>
                {selected
                  ? <CheckCircle2 className="size-[22px] shrink-0 fill-ios-accent text-surface" aria-hidden="true" />
                  : <ChevronRight className="size-[18px] shrink-0 text-ios-label-secondary" strokeWidth={2.6} aria-hidden="true" />}
                <span className="absolute bottom-0 inset-x-0 h-px bg-border" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </MobileFilterScreen>
  );
}

function ChoiceThumbnail({ kind, option }: { kind: EntityPickerKind; option: EntityPickerOption }) {
  const [failed, setFailed] = useState(false);
  if (kind === "product") {
    return (
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-ios-accent/12 text-ios-accent">
        {option.imageUrl && !failed
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={option.imageUrl} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
          : <Package className="size-5" strokeWidth={2} aria-hidden="true" />}
      </span>
    );
  }
  if (kind !== "customer") {
    const Icon = kind === "order" ? FileText : kind === "project" ? Building2 : Package;
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-ios-accent/12 text-ios-accent">
        <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-ios-accent text-[17px] font-bold text-white">
      {(option.label.trim()[0] ?? "?").toLocaleUpperCase("vi")}
    </span>
  );
}

function formatDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function formatFilterDateRange(from: string, to: string) {
  if (!from && !to) return "";
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/**
 * Phone date filter screen: preset list with a checkmark (LumaSelectField options)
 * and, for "custom", from/to date rows using the native iOS date picker.
 */
export function MobileDateRangeScreen({
  title,
  presets,
  preset,
  from,
  to,
  resolvePreset,
  onApply,
  onClose,
}: {
  title: string;
  presets: ReadonlyArray<PickerOption>;
  preset: string;
  from: string;
  to: string;
  resolvePreset: (preset: string) => { from: string; to: string } | null;
  onApply: (next: { preset: string; from: string; to: string }) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [draftPreset, setDraftPreset] = useState(preset);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const custom = draftPreset === "custom";
  const customRef = useRef<HTMLDivElement>(null);
  // Bring the from/to rows into view when "Custom" is picked at the bottom of the list.
  useEffect(() => {
    if (custom) customRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [custom]);
  const valid = !custom || isOrderDateRangeValid(draftFrom, draftTo);

  function choose(next: string) {
    if (next === "custom") {
      // Like the native date pickers, empty bounds start at today.
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      setDraftPreset("custom");
      if (!draftFrom) setDraftFrom(today);
      if (!draftTo) setDraftTo(today);
      return;
    }
    const range = resolvePreset(next);
    onApply({ preset: next, from: range?.from ?? "", to: range?.to ?? "" });
    onClose();
  }

  const row = "relative flex min-h-11 w-full items-center gap-3 px-4 py-[11px] text-left text-[17px]";
  const separator = <span className="absolute left-4 right-0 top-0 h-px bg-border" aria-hidden="true" />;

  return (
    <MobileFilterScreen
      title={title}
      onBack={onClose}
      footer={custom ? (
        <div className="border-t border-border bg-surface px-ios-inset pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              onApply({ preset: "custom", from: draftFrom, to: draftTo });
              onClose();
            }}
            className="flex h-[52px] w-full items-center justify-center rounded-[14px] bg-ios-accent text-[17px] font-bold text-white disabled:opacity-40"
          >
            {t("mobile.invoices.filters.apply")}
          </button>
        </div>
      ) : undefined}
    >
      <div className="space-y-ios-section px-ios-inset py-ios-section">
        <div role="radiogroup" aria-label={title} className="overflow-hidden rounded-[26px] bg-surface">
          {presets.map((option, index) => {
            const selected = option.value === draftPreset;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(option.value)}
                className={cn(row, "active:bg-black/[0.06] dark:active:bg-white/[0.08]")}
              >
                {index > 0 && separator}
                <span className="min-w-0 flex-1">{option.label}</span>
                {selected && <Check className="size-5 shrink-0 text-ios-accent" strokeWidth={2.8} aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {custom && (
          <div ref={customRef} className="space-y-2">
            <div className="overflow-hidden rounded-[26px] bg-surface">
              <label className={row}>
                <span className="min-w-0 flex-1">{t("mobile.invoices.filters.fromDate")}</span>
                <input
                  type="date"
                  value={draftFrom}
                  max={draftTo || undefined}
                  onChange={(event) => setDraftFrom(event.target.value)}
                  className="h-[34px] rounded-[8px] bg-[rgb(118_118_128/0.12)] px-2.5 text-[17px] text-ios-label outline-none"
                />
              </label>
              <label className={row}>
                {separator}
                <span className="min-w-0 flex-1">{t("mobile.invoices.filters.toDate")}</span>
                <input
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  onChange={(event) => setDraftTo(event.target.value)}
                  className="h-[34px] rounded-[8px] bg-[rgb(118_118_128/0.12)] px-2.5 text-[17px] text-ios-label outline-none"
                />
              </label>
            </div>
            {!valid && <p className="px-4 text-[13px] text-ios-red">{t("mobile.invoices.filters.invalidRange")}</p>}
          </div>
        )}
      </div>
    </MobileFilterScreen>
  );
}
