"use client";

import { useMemo, useState, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Banknote, BadgeCheck, CalendarClock, ChevronRight, ListChecks, SearchX, SlidersHorizontal } from "lucide-react";
import { ListSearchInput } from "@/components/list-search-filter";
import { MobileGroupedSection } from "@/components/mobile-pushed-screen";
import {
  DEFAULT_PARTNER_DEBT_FILTER,
  matchesPartnerDebtFilter,
  type PartnerDebtFilterValue,
  type PartnerDebtKind,
  type PartnerDebtTime,
} from "@/components/partners/partner-debt-filter";
import { LumaWebPicker } from "@/app/(app)/sales/tabs/filter-drawer-shared";
import { FilterDrawerFooter, FilterSection, MobileFilterHeader } from "@/app/(app)/sales/tabs/filter-drawer-sections";
import { cn, formatCurrency } from "@/lib/utils";
import { useModalLayer } from "@/components/ui/use-modal-layer";

/**
 * Phone sub-screens of the partner profiles, ported from
 * CustomerSalesHistoryView / SupplierHistoryView (day-grouped transactions with
 * a search bar and summary card) and CustomerReceivablesView /
 * SupplierPayablesView (balance card, filter row, debt ledger, action bar).
 */

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function toDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function shortDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

/** NativeInventoryFormatting.date: dd/MM/yyyy HH:mm. */
export function mobileLedgerDateTime(value: Date | string) {
  const date = toDate(value);
  if (!date) return "—";
  return `${shortDate(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export type MobileHistoryItem = {
  id: string;
  createdAt: Date | string;
  /** Signed contribution to the net total (returns are negative). */
  net: number;
  searchText: string;
  row: ReactNode;
};

/** Transaction history: search bar, summary card and day sections. */
export function MobileHistoryContent({
  items,
  icon,
  netLabel,
  searchPlaceholder,
}: {
  items: MobileHistoryItem[];
  icon: ReactNode;
  netLabel: string;
  searchPlaceholder: string;
}) {
  const t = useTranslations("mobile.partnerLedger");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    return needle ? items.filter((item) => item.searchText.toLocaleLowerCase("vi").includes(needle)) : items;
  }, [items, query]);
  const groups = useMemo(() => {
    const now = new Date();
    const today = localDayKey(now);
    const yesterday = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const result: Array<{ key: string; title: string; items: MobileHistoryItem[]; total: number }> = [];
    for (const item of visible) {
      const date = toDate(item.createdAt);
      const key = date ? localDayKey(date) : "";
      let group = result[result.length - 1];
      if (!group || group.key !== key) {
        const title = !date ? "—" : key === today ? t("today") : key === yesterday ? t("yesterday") : shortDate(date);
        group = { key, title, items: [], total: 0 };
        result.push(group);
      }
      group.items.push(item);
      group.total += item.net;
    }
    return result;
  }, [visible, t]);
  const netTotal = visible.reduce((sum, item) => sum + item.net, 0);

  return (
    <div className="min-h-full bg-surface">
      {/* LumaSearchFilterBar pinned under the navigation bar. */}
      <div className="sticky top-0 z-10 bg-surface px-ios-inset pb-2 pt-1">
        <ListSearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} />
      </div>
      <div className="px-ios-inset pt-2">
        <div className="flex items-center gap-3 rounded-[16px] bg-surface p-3.5 shadow-[0_0_0_1px_var(--color-border)]">
          <span className="grid size-[42px] shrink-0 place-items-center rounded-[13px] bg-ios-accent/10 text-ios-accent">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{t("summaryCount", { count: visible.length })}</span>
            <span className="mt-0.5 block text-[12px] text-ios-label-secondary">{netLabel}</span>
          </span>
          <span className="shrink-0 text-right text-[15px] font-bold tabular-nums">{formatCurrency(netTotal)}</span>
        </div>
      </div>
      {groups.length === 0 ? (
        <div className="flex flex-col items-center px-8 py-14 text-center">
          <SearchX className="size-10 text-ios-label-tertiary" aria-hidden="true" />
          <p className="mt-3 text-[20px] font-bold">{query ? t("emptyTitle") : t("noActivity")}</p>
          {query && <p className="mt-1 text-[15px] text-ios-label-secondary">{t("emptyMessage")}</p>}
        </div>
      ) : groups.map((group) => (
        <section key={group.key || "unknown"}>
          <div className="flex items-baseline justify-between gap-3 px-ios-inset pb-1 pt-5" role="heading" aria-level={3}>
            <span className="text-[15px] font-semibold">{group.title}</span>
            <span className="text-[12px] tabular-nums text-ios-label-secondary">{t("daySummary", { count: group.items.length, total: formatCurrency(group.total) })}</span>
          </div>
          <div className="[&>*:last-child]:border-b-0">
            {group.items.map((item) => <div key={item.id}>{item.row}</div>)}
          </div>
        </section>
      ))}
      <div className="h-6" aria-hidden="true" />
    </div>
  );
}

/** Tappable history row: content with an inset hairline below. */
export function MobileHistoryRow({ onOpen, children, label }: { onOpen?: () => void; children: ReactNode; label: string }) {
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      aria-label={onOpen ? label : undefined}
      className="block w-full border-b border-border pl-ios-inset text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <span data-row-line className="flex items-center gap-3 py-ios-row pr-ios-inset">{children}</span>
    </Tag>
  );
}

export type MobileLedgerEntry = {
  id: string;
  kind: string;
  createdAt: Date | string;
  label: string;
  code: string;
  value: number;
  balance: number;
  reason: string | null;
  receiptStatus?: string | null;
  cancellationReason?: string | null;
  onOpen?: () => void;
  /** Extra control under the row (e.g. cancel a payment voucher). */
  extra?: ReactNode;
};

const timeKeys: PartnerDebtTime[] = ["all", "today", "7d", "30d", "custom"];
const kindKeys: PartnerDebtKind[] = ["all", "debt", "payment", "adjustment"];

/** NativeCustomerDebtEntryRow / supplier ledger row. */
function LedgerRow({ entry }: { entry: MobileLedgerEntry }) {
  const t = useTranslations("mobile.partnerLedger");
  const Tag = entry.onOpen ? "button" : "div";
  return (
    <div className="pl-4">
      <Tag
        type={entry.onOpen ? "button" : undefined}
        onClick={entry.onOpen}
        className="block w-full space-y-1.5 py-ios-row pr-4 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold">{entry.label}</span>
          <span className={cn("shrink-0 text-[15px] font-semibold tabular-nums", entry.value > 0 ? "text-ios-orange" : entry.value < 0 ? "text-ios-green" : "")}>
            {entry.value > 0 ? "+" : ""}{formatCurrency(entry.value)}
          </span>
        </span>
        <span className="flex items-baseline gap-1.5 text-[11px] text-ios-label-secondary">
          <span className="min-w-0 flex-1 truncate">{[mobileLedgerDateTime(entry.createdAt), entry.code].filter(Boolean).join(" · ")}</span>
          <span className="shrink-0 text-[13px] tabular-nums">{t("balance", { amount: formatCurrency(entry.balance) })}</span>
        </span>
        {entry.receiptStatus === "cancelled" && <span className="block text-[12px] font-semibold text-ios-orange">{t("cancelled")}</span>}
        {entry.reason && <span className="line-clamp-2 block text-[12px] text-ios-label-secondary">{entry.reason}</span>}
        {entry.cancellationReason && <span className="line-clamp-2 block text-[12px] text-ios-orange">{t("cancelReason", { reason: entry.cancellationReason })}</span>}
      </Tag>
      {entry.extra && <div className="pb-3 pr-4">{entry.extra}</div>}
    </div>
  );
}

/** Debt ledger: balance card, filter row, ledger section and the action bar. */
export function MobileLedgerContent({
  partnerName,
  balance,
  balanceLabel,
  balanceHeader,
  positiveTone,
  reconciledAt,
  beforeLedger,
  entries,
  collectLabel,
  adjustLabel,
  collectDisabled,
  onCollect,
  onAdjust,
}: {
  partnerName: string;
  balance: number;
  balanceLabel: string;
  /** Optional grey section header above the balance card. */
  balanceHeader?: string;
  /** Colour of a positive balance: customers red, suppliers orange. */
  positiveTone: "red" | "orange";
  reconciledAt?: Date | string | null;
  beforeLedger?: ReactNode;
  entries: MobileLedgerEntry[];
  collectLabel: string;
  adjustLabel: string;
  collectDisabled: boolean;
  onCollect: () => void;
  onAdjust: () => void;
}) {
  const t = useTranslations("mobile.partnerLedger");
  const [filter, setFilter] = useState<PartnerDebtFilterValue>(DEFAULT_PARTNER_DEBT_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const visible = useMemo(() => entries.filter((entry) => matchesPartnerDebtFilter(entry, filter)), [entries, filter]);
  const isDefault = filter.time === "all" && filter.kind === "all";
  const timeTitle = filter.time === "custom" && filter.from && filter.to
    ? `${filter.from.split("-").reverse().join("/")} – ${filter.to.split("-").reverse().join("/")}`
    : t(`filters.${filter.time}`);
  const tone = balance > 0 ? (positiveTone === "red" ? "text-ios-red" : "text-ios-orange") : "text-ios-green";

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-ios-section px-ios-inset pt-2 pb-4">
        <MobileGroupedSection title={balanceHeader}>
          <div className={cn("space-y-2 px-4 py-4", balance > 0 && positiveTone === "red" && "bg-ios-red/[0.07]")}>
            <p className="text-[15px] text-ios-label-secondary">{partnerName}</p>
            {positiveTone === "red" && <p className="text-[12px] text-ios-label-secondary">{balanceLabel}</p>}
            <p className={cn("text-[34px] font-bold leading-[41px] tabular-nums", tone)}>{formatCurrency(balance)}</p>
            {positiveTone === "orange" && <p className="text-[12px] text-ios-label-secondary">{balanceLabel}</p>}
            {reconciledAt && (
              <p className="flex items-center gap-1.5 text-[12px] text-ios-green">
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                {t("reconciledAt", { date: mobileLedgerDateTime(reconciledAt) })}
              </p>
            )}
          </div>
        </MobileGroupedSection>

        {beforeLedger}

        <MobileGroupedSection title={t("ledger")}>
          <button type="button" onClick={() => setFilterOpen(true)} className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04]">
            <CalendarClock className="size-5 shrink-0 text-ios-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{timeTitle}</span>
              <span className="mt-0.5 block text-[12px] text-ios-label-secondary">{t(filter.kind === "all" ? "filters.allKinds" : `filters.${filter.kind}`)}</span>
            </span>
            {!isDefault && <span className="size-[7px] rounded-full bg-ios-accent" aria-hidden="true" />}
            <ChevronRight className="size-4 text-ios-label-tertiary" strokeWidth={2.6} aria-hidden="true" />
          </button>
          {visible.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-8 text-center">
              <ListChecks className="size-8 text-ios-label-tertiary" aria-hidden="true" />
              <p className="mt-2 text-[15px] font-semibold">{t(isDefault ? "noTransactions" : "noFiltered")}</p>
            </div>
          ) : visible.map((entry) => <LedgerRow key={`${entry.kind}-${entry.id}`} entry={entry} />)}
        </MobileGroupedSection>
      </div>

      <div className="sticky bottom-0 z-10 flex gap-2.5 border-t border-border bg-surface/90 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl">
        <button
          type="button"
          onClick={onCollect}
          disabled={collectDisabled}
          className="inline-flex min-h-[50px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-ios-accent px-3 text-[16px] font-semibold text-white disabled:opacity-40"
        >
          <Banknote className="size-[18px]" aria-hidden="true" />
          {collectLabel}
        </button>
        <button
          type="button"
          onClick={onAdjust}
          className="inline-flex min-h-[50px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-ios-accent/10 px-3 text-[16px] font-semibold text-ios-accent"
        >
          <SlidersHorizontal className="size-[18px]" aria-hidden="true" />
          {adjustLabel}
        </button>
      </div>

      {filterOpen && (
        <MobileLedgerFilterScreen
          value={filter}
          onClose={() => setFilterOpen(false)}
          onApply={(next) => {
            setFilter(next);
            setFilterOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Full-screen ledger filter (time period and transaction type). */
function MobileLedgerFilterScreen({
  value,
  onApply,
  onClose,
}: {
  value: PartnerDebtFilterValue;
  onApply: (value: PartnerDebtFilterValue) => void;
  onClose: () => void;
}) {
  const t = useTranslations("mobile.partnerLedger.filters");
  const filterScreenRef = useRef<HTMLDivElement>(null);
  useModalLayer({ onEscape: onClose, elementRef: filterScreenRef });
  const [draft, setDraft] = useState<PartnerDebtFilterValue>(() => value.time === "custom" && !value.from
    ? { ...value, ...defaultRange() }
    : value);
  const invalid = draft.time === "custom" && (!draft.from || !draft.to || draft.to < draft.from);
  const count = (draft.time === "all" ? 0 : 1) + (draft.kind === "all" ? 0 : 1);

  return createPortal(
    <div ref={filterScreenRef} role="dialog" aria-modal="true" aria-label={t("title")} className="fixed inset-0 z-[110] flex flex-col bg-canvas lg:hidden">
      <MobileFilterHeader title={t("title")} conditionCount={count} onCancel={onClose} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) onApply(draft.time === "custom" ? draft : { ...draft, from: "", to: "" });
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 space-y-ios-section overflow-y-auto overscroll-contain px-4 pb-6 pt-1">
          <FilterSection title={t("time")} mobileTitle="">
            <LumaWebPicker
              name="time"
              ariaLabel={t("time")}
              rowLabel={t("time")}
              value={draft.time}
              options={timeKeys.map((key) => ({ value: key, label: t(key) }))}
              onChange={(time) => setDraft((current) => ({
                ...current,
                time: time as PartnerDebtTime,
                ...(time === "custom" && !current.from ? defaultRange() : {}),
              }))}
            />
            {draft.time === "custom" && (
              <>
                <DateRow label={t("from")} value={draft.from} onChange={(from) => setDraft((current) => ({ ...current, from }))} />
                <DateRow label={t("to")} value={draft.to} onChange={(to) => setDraft((current) => ({ ...current, to }))} />
              </>
            )}
          </FilterSection>
          {invalid && <p className="px-4 text-[13px] text-ios-red">{t("invalidRange")}</p>}
          <FilterSection title={t("kind")} mobileTitle="">
            <LumaWebPicker
              name="kind"
              ariaLabel={t("kind")}
              rowLabel={t("kind")}
              value={draft.kind}
              options={kindKeys.map((key) => ({ value: key, label: t(key === "all" ? "allKinds" : key) }))}
              onChange={(kind) => setDraft((current) => ({ ...current, kind: kind as PartnerDebtKind }))}
            />
          </FilterSection>
        </div>
        <FilterDrawerFooter
          onClear={() => setDraft(DEFAULT_PARTNER_DEBT_FILTER)}
          invalid={invalid}
          pending={false}
          desktopApplyLabel={t("apply")}
          mobileApplyLabel={t("apply")}
          mobileClearLabel={t("reset")}
        />
      </form>
    </div>,
    document.body,
  );
}

function defaultRange() {
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = new Date();
  return { from: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)), to: iso(today) };
}

function DateRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-2 px-4 py-1.5 text-[17px]">
      <span className="min-w-0 flex-1">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-[34px] rounded-[8px] bg-[rgb(118_118_128/0.12)] px-2.5 text-[17px] text-ios-label outline-none"
      />
    </label>
  );
}
