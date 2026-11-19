"use client";

import { useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Banknote, Ban, ChevronRight, CircleX, Pencil, Phone, Receipt, SlidersHorizontal, Undo2, UserRound } from "lucide-react";
import { MobileGroupedSection, MobilePushedScreen } from "@/components/mobile-pushed-screen";
import { CustomerGrossProfit } from "@/components/customer-gross-profit";
import { CustomerEdit } from "@/app/(app)/customers/[id]/customer-edit";
import {
  CustomerReceivableActions,
  type CustomerReceivableActionsHandle,
} from "@/components/partners/customer-receivable-actions";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { setCustomerActive } from "@/lib/actions/partners";
import { cn, formatCurrency } from "@/lib/utils";
import type { CustomerDebtLedgerRow, CustomerSalesHistoryRow } from "@/lib/data/partners";
import { CancelFinancialVoucherButton } from "@/components/partners/cancel-financial-voucher-button";
import {
  MobileHistoryContent,
  MobileHistoryRow,
  MobileLedgerContent,
} from "@/components/partners/partner-mobile-ledger";
import { mobileDocumentTimestamp } from "@/app/(app)/sales/tabs/mobile-document-day";
import { orderMobileStatusKey } from "@/app/(app)/sales/tabs/orders-table";
import { Routes } from "@/lib/routes";
import { LumaWebPicker } from "@/app/(app)/sales/tabs/filter-drawer-shared";
import {
  AmountRangeRows,
  FilterDrawerFooter,
  FilterSection,
  LabeledInput,
  MobileFilterHeader,
  MobileSwitchRow,
} from "@/app/(app)/sales/tabs/filter-drawer-sections";

/**
 * Phone UI for the customer list and profile, ported from CustomersView.swift and
 * CustomerDetailView.swift. Desktop keeps the data table and preview modal.
 */

type CustomerType = "retail" | "wholesale" | "contractor" | "agent";

export type MobileCustomer = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  addressLine?: string;
  addressProvinceCode?: string;
  addressWardCode?: string;
  zaloUserId: string | null;
  type: CustomerType;
  taxCode: string | null;
  debtLimit: string | null;
  note: string | null;
  isActive: boolean;
  currentDebt: string | number;
  totalSpent: string | number;
  salesHistory: CustomerSalesHistoryRow[];
  debtLedger: CustomerDebtLedgerRow[];
};

/** NativeCustomerListPresentation.compactMoney: 1.2Mđ, 350Kđ, 900đ. */
export function compactMoney(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 1_000_000_000) return `${sign}${(absolute / 1_000_000_000).toFixed(1)}Bđ`;
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(1)}Mđ`;
  if (absolute >= 1_000) return `${sign}${Math.round(absolute / 1_000)}Kđ`;
  return `${sign}${Math.round(absolute)}đ`;
}

const typeTone: Record<CustomerType, { text: string; bg: string; soft: string }> = {
  retail: { text: "text-ios-label-secondary", bg: "bg-[rgb(60_60_67/0.6)] dark:bg-[rgb(235_235_245/0.6)]", soft: "bg-[rgb(60_60_67/0.06)] dark:bg-[rgb(235_235_245/0.1)]" },
  wholesale: { text: "text-ios-accent", bg: "bg-ios-accent", soft: "bg-ios-accent/10" },
  contractor: { text: "text-ios-orange", bg: "bg-ios-orange", soft: "bg-ios-orange/10" },
  agent: { text: "text-[#AF52DE] dark:text-[#BF5AF2]", bg: "bg-[#AF52DE] dark:bg-[#BF5AF2]", soft: "bg-[#AF52DE]/10" },
};

function lastInitial(name: string) {
  return name.trim().split(/\s+/).pop()?.[0]?.toLocaleUpperCase("vi") ?? "?";
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(-2).map((part) => part[0] ?? "").join("").toLocaleUpperCase("vi");
}

/** NativeInventoryFormatting.currency: 4.514.112.891đ (no space, plain "đ"). */
export function nativeCurrency(value: number) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Math.round(value))}đ`;
}

/**
 * LumaListTotalsCard with centred metrics separated by hairlines. `large` is the
 * SuppliersView variant (subheadline titles, headline values, 22pt title row).
 */
export function MobileListTotalsCard({ metrics, large = false }: { metrics: Array<{ id: string; title: string; value: string; tone?: string }>; large?: boolean }) {
  return (
    <div className="mx-ios-inset mb-1.5 flex items-start rounded-[8px] bg-surface px-3.5 py-3 lg:hidden">
      {metrics.map((metric, index) => (
        <div key={metric.id} className="contents">
          {index > 0 && (
            <span className="mx-2.5 flex h-[54px] w-px shrink-0 items-center" aria-hidden="true">
              <span className="h-[38px] w-px bg-black/[0.08] dark:bg-white/[0.08]" />
            </span>
          )}
          <div className="min-w-0 flex-1 text-center">
            <div
              className={cn(
                "flex items-start justify-center text-ios-label-secondary",
                large ? "h-[22px] text-[15px] leading-5" : "h-[34px] text-[12px] leading-4",
              )}
            >
              {metric.title}
            </div>
            <div
              className={cn(
                "whitespace-nowrap font-semibold tabular-nums",
                large ? "mt-0.5 text-[clamp(13px,4.4vw,17px)] leading-[22px]" : "mt-[5px] text-[clamp(10px,3vw,13px)] leading-[18px]",
                metric.tone,
              )}
            >
              {metric.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** NativeCustomerRow. */
export function CustomerMobileRow({ customer, onOpen }: { customer: Pick<MobileCustomer, "id" | "name" | "code" | "phone" | "type" | "currentDebt" | "totalSpent">; onOpen: () => void }) {
  const t = useTranslations("mobile.customers");
  const tone = typeTone[customer.type] ?? typeTone.retail;
  const debt = Number(customer.currentDebt);
  const subtitle = [customer.code, customer.phone].map((part) => part?.trim()).filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-ios-inset py-2 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <span className={cn("grid size-[42px] shrink-0 place-items-center rounded-[14px] text-[17px] font-bold text-white", tone.bg)}>
        {lastInitial(customer.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-[5px]">
          <span className="truncate text-[17px] font-bold leading-[22px]">{customer.name}</span>
          <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[12px] font-semibold leading-4", tone.text, tone.soft)}>
            {t(`tier.${customer.type}`)}
          </span>
        </span>
        {subtitle && <span className="mt-1 block truncate font-mono text-[12px] leading-4 text-ios-label-secondary">{subtitle}</span>}
      </span>
      <span className="flex min-h-[47px] shrink-0 flex-col items-end justify-center gap-0.5">
        <span className="text-[15px] font-bold tabular-nums text-ios-accent">{compactMoney(Number(customer.totalSpent))}</span>
        {debt !== 0 && (
          <span className={cn("text-[15px] font-bold tabular-nums", debt > 0 ? "text-ios-red" : "text-ios-label-secondary")}>
            {debt > 0 ? t("debtBadge", { amount: compactMoney(debt) }) : compactMoney(debt)}
          </span>
        )}
      </span>
    </button>
  );
}

/** NativeWalkInCustomerRow. */
export function WalkInMobileRow({ orderCount, netSales, onOpen }: { orderCount: number; netSales: number; onOpen: () => void }) {
  const t = useTranslations("mobile.customers");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-ios-inset py-2 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <span className="grid size-[42px] shrink-0 place-items-center rounded-[14px] bg-ios-accent/10 text-ios-accent">
        <UserRound className="size-4 fill-current" strokeWidth={2.4} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-bold leading-[22px]">{t("walkInTitle")}</span>
        <span className="mt-1 block text-[12px] leading-4 text-ios-label-secondary">{t("walkInOrderCount", { count: orderCount })}</span>
      </span>
      <span className="shrink-0 text-[15px] font-bold tabular-nums text-ios-accent">{compactMoney(netSales)}</span>
    </button>
  );
}

export function RowChevron() {
  return <ChevronRight className="size-[18px] shrink-0 text-ios-label-tertiary" strokeWidth={2.6} aria-hidden="true" />;
}

export function LabeledRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-[11px] text-[17px]">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 text-right text-ios-label-secondary [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

export function MenuAction({ icon: Icon, label, onSelect, disabled, destructive }: { icon: typeof Pencil; label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <button
      type="button"
      data-menu-action
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex h-12 w-full items-center gap-3 rounded-[14px] bg-surface px-4 text-left text-[17px] disabled:opacity-40",
        destructive ? "text-ios-red" : "text-ios-label",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * Customer profile pushed on phones (CustomerDetailView): identity, history and
 * debt rows that push their own screens, gross profit, contact details, and the
 * "…" menu (edit, collect debt, adjust debt, deactivate).
 */
export function MobileCustomerDetail({
  customer,
  onBack,
}: {
  customer: MobileCustomer;
  onBack: () => void;
}) {
  const t = useTranslations("mobile.customers");
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [editOpen, setEditOpen] = useState(false);
  const [route, setRoute] = useState<"history" | "debt" | null>(null);
  const receivablesRef = useRef<CustomerReceivableActionsHandle>(null);
  const debt = Number(customer.currentDebt);
  const transactionCount = customer.salesHistory.filter((entry) => entry.status !== "cancelled").length;
  const contactEmpty = !customer.phone && !customer.email && !customer.address;

  async function deactivate() {
    const ok = await dialog.confirm({ description: t("stop"), confirmLabel: t("stop"), variant: "warning" });
    if (!ok) return;
    const result = await setCustomerActive({ id: customer.id, isActive: false });
    if (result.ok) {
      onBack();
      router.refresh();
    }
  }

  return (
    <MobilePushedScreen
      title={customer.name}
      onBack={onBack}
      actions={(
        <div className="space-y-2">
          <MenuAction icon={Pencil} label={t("edit")} onSelect={() => setEditOpen(true)} />
          <MenuAction icon={Banknote} label={t("collectDebt")} disabled={debt <= 0} onSelect={() => receivablesRef.current?.open("collect")} />
          <MenuAction icon={SlidersHorizontal} label={t("adjustDebt")} onSelect={() => receivablesRef.current?.open("adjust")} />
          {customer.isActive && <MenuAction icon={Ban} label={t("stop")} destructive onSelect={() => void deactivate()} />}
        </div>
      )}
    >
      <div className="space-y-ios-section px-ios-inset pt-2">
        <MobileGroupedSection>
          {/* NativeCustomerProfileIdentityRow */}
          <div className="flex items-center gap-3.5 px-4 py-[18px]">
            <span className="grid size-[62px] shrink-0 place-items-center rounded-full bg-ios-accent/12 text-[22px] font-semibold text-ios-accent">
              {initials(customer.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[20px] font-bold leading-[25px]">{customer.name}</span>
              <span className="mt-1 block text-[15px] text-ios-label-secondary">{t(`tier.${customer.type}`)}</span>
            </span>
          </div>
        </MobileGroupedSection>

        <MobileGroupedSection>
          <button type="button" onClick={() => setRoute("history")} className="flex min-h-11 w-full items-center gap-1 py-[11px] pl-4 pr-2 text-left text-[17px] active:bg-black/[0.04]">
            <span className="min-w-0 flex-1">{t("transactionHistory")}</span>
            <span className="text-[12px] text-ios-label-secondary">{t("transactionCount", { count: transactionCount })}</span>
            <RowChevron />
          </button>
          <button type="button" onClick={() => setRoute("debt")} className="flex min-h-11 w-full items-center gap-1 py-[11px] pl-4 pr-2 text-left text-[17px] active:bg-black/[0.04]">
            <span className="min-w-0 flex-1">{t("currentDebt")}</span>
            <span className="text-[15px] tabular-nums text-ios-red">{formatCurrency(debt)}</span>
            <RowChevron />
          </button>
          <CustomerGrossProfit customerId={customer.id} variant="row" />
        </MobileGroupedSection>

        <MobileGroupedSection title={t("contact")}>
          {customer.phone && <LabeledRow label={t("phone")} value={customer.phone} />}
          {customer.phone && (
            <a href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`} className="flex min-h-11 items-center gap-2 px-4 py-[11px] text-[17px] text-ios-accent">
              <Phone className="size-[18px]" aria-hidden="true" />
              {t("call")}
            </a>
          )}
          {customer.email && <LabeledRow label={t("email")} value={customer.email} />}
          {customer.address && <LabeledRow label={t("address")} value={customer.address} />}
          {customer.zaloUserId && <LabeledRow label={t("zalo")} value={customer.zaloUserId} />}
          {contactEmpty && <p className="px-4 py-[11px] text-[17px] text-ios-label-secondary">{t("noContact")}</p>}
        </MobileGroupedSection>
      </div>

      {route === "history" && (
        <CustomerHistoryScreen customer={customer} transactionCount={transactionCount} onBack={() => setRoute(null)} />
      )}
      {route === "debt" && (
        <CustomerLedgerScreen
          customer={customer}
          onBack={() => setRoute(null)}
          onCollect={() => receivablesRef.current?.open("collect")}
          onAdjust={() => receivablesRef.current?.open("adjust")}
        />
      )}

      <CustomerEdit
        hideTrigger
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={{
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          zaloUserId: customer.zaloUserId,
          address: customer.address,
          addressLine: customer.addressLine,
          addressProvinceCode: customer.addressProvinceCode,
          addressWardCode: customer.addressWardCode,
          type: customer.type,
          taxCode: customer.taxCode,
          debtLimit: customer.debtLimit,
          note: customer.note,
        }}
      />
      {/* Portalled so the dialogs also cover screens pushed above this one. */}
      {createPortal(<CustomerReceivableActions hideTriggers handleRef={receivablesRef} customerId={customer.id} currentDebt={debt} />, document.body)}
    </MobilePushedScreen>
  );
}

/** Opens a URL-owned detail overlay (order) above the pushed screens. */
function useOpenDetailParam() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (key: string, id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, id);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
}

/** Two-line principal title: screen title and a caption. */
function PrincipalTitle({ title, caption }: { title: string; caption: string }) {
  return (
    <span className="block leading-tight">
      <span className="block truncate text-[17px] font-semibold">{title}</span>
      <span className="block truncate text-[12px] font-normal text-ios-label-secondary">{caption}</span>
    </span>
  );
}

/** CustomerSalesHistoryView. */
function CustomerHistoryScreen({ customer, transactionCount, onBack }: { customer: MobileCustomer; transactionCount: number; onBack: () => void }) {
  const t = useTranslations();
  const tl = useTranslations("mobile.partnerLedger");
  const locale = useLocale();
  const openDetail = useOpenDetailParam();
  const router = useRouter();
  const items = customer.salesHistory.map((entry) => {
    const total = Number(entry.total);
    const isReturn = entry.kind === "return";
    const names = entry.productNames?.replaceAll(" {DEL}", " (DEL)").trim();
    const itemSummary = entry.itemCount > 0
      ? names ? t("mobile.invoices.itemSummary", { count: entry.itemCount, names }) : t("mobile.invoices.itemCount", { count: entry.itemCount })
      : names || null;
    const onOpen = isReturn
      ? () => router.push(`${Routes.Sales}?tab=returns&expandedReturn=${entry.id}`)
      : entry.orderId ? () => openDetail("detailOrderId", entry.orderId!) : undefined;
    return {
      id: `${entry.kind}-${entry.id}`,
      createdAt: entry.createdAt,
      net: isReturn ? -total : total,
      searchText: `${entry.code} ${entry.productNames ?? ""}`,
      row: (
        <MobileHistoryRow onOpen={onOpen} label={`${customer.name} · ${entry.code}`}>
          {isReturn && (
            <span className="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-ios-orange/10 text-ios-orange">
              <Undo2 className="size-5" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate text-[17px] font-semibold leading-[22px]">{customer.name}</span>
              <span className={cn("shrink-0 text-[17px] font-semibold tabular-nums", isReturn && "text-[15px] text-ios-orange")}>{formatCurrency(total)}</span>
            </span>
            <span className="block text-[15px] leading-5 text-ios-label-secondary">
              {isReturn
                ? [tl("returned"), entry.itemCount > 0 ? tl("itemCount", { count: entry.itemCount }) : null].filter(Boolean).join(" · ")
                : t(`mobile.invoices.status.${orderMobileStatusKey(entry.status, entry.paymentStatus)}`)}
            </span>
            {!isReturn && itemSummary && <span className="line-clamp-2 block text-[12px] leading-4 text-ios-label-secondary">{itemSummary}</span>}
            <span className="block truncate text-[11px] leading-[13px] text-ios-label-tertiary">{mobileDocumentTimestamp(entry.createdAt, locale)} · {entry.code}</span>
          </span>
        </MobileHistoryRow>
      ),
    };
  });
  return (
    <MobilePushedScreen
      title={<PrincipalTitle title={tl("historyTitle")} caption={tl("orderCount", { count: transactionCount })} />}
      onBack={onBack}
      layer={1}
      className="bg-surface"
    >
      <MobileHistoryContent
        items={items}
        icon={<Receipt className="size-5" strokeWidth={2.4} aria-hidden="true" />}
        netLabel={tl("customerNet")}
        searchPlaceholder={tl("customerSearch")}
      />
    </MobilePushedScreen>
  );
}

/** CustomerReceivablesView. */
function CustomerLedgerScreen({
  customer,
  onBack,
  onCollect,
  onAdjust,
}: {
  customer: MobileCustomer;
  onBack: () => void;
  onCollect: () => void;
  onAdjust: () => void;
}) {
  const tl = useTranslations("mobile.partnerLedger");
  const router = useRouter();
  const openDetail = useOpenDetailParam();
  const debt = Number(customer.currentDebt);
  return (
    <MobilePushedScreen title={tl("customerDebtTitle")} onBack={onBack} layer={1}>
      <MobileLedgerContent
        partnerName={customer.name}
        balance={debt}
        balanceLabel={tl("currentBalance")}
        positiveTone="red"
        reconciledAt={customer.debtLedger[0]?.createdAt ?? null}
        entries={customer.debtLedger.map((row) => ({
          ...row,
          label: row.typeLabel,
          onOpen: row.orderId ? () => openDetail("detailOrderId", row.orderId!) : undefined,
          extra: row.kind === "payment" && row.receiptId && row.receiptStatus === "confirmed" ? (
            <CancelFinancialVoucherButton
              kind="customer"
              receiptId={row.receiptId}
              partyId={customer.id}
              code={row.code}
              amount={Math.abs(row.value)}
              onCancelled={() => router.refresh()}
            />
          ) : undefined,
        }))}
        collectLabel={tl("collect")}
        adjustLabel={tl("adjust")}
        collectDisabled={debt <= 0}
        onCollect={onCollect}
        onAdjust={onAdjust}
      />
    </MobilePushedScreen>
  );
}

type CustomerFilterDraft = {
  type: string;
  owing: boolean;
  createdFrom: string;
  createdTo: string;
  lastTxFrom: string;
  lastTxTo: string;
  totalFrom: string;
  totalTo: string;
  debtFrom: string;
  debtTo: string;
};

function filterDraftCount(draft: CustomerFilterDraft) {
  return [
    Boolean(draft.type),
    draft.owing,
    Boolean(draft.createdFrom || draft.createdTo),
    Boolean(draft.lastTxFrom || draft.lastTxTo),
    Boolean(draft.totalFrom || draft.totalTo),
    Boolean(draft.debtFrom || draft.debtTo),
  ].filter(Boolean).length;
}

/** LumaOptionalDateTimePickerField row with the clear button. */
function OptionalDateRow({ label, value, clearLabel, onChange }: { label: string; value: string; clearLabel: string; onChange: (value: string) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-2 px-4 py-1.5 text-[17px]">
      <span className="min-w-0 flex-1">{label}</span>
      <input
        type="date"
        value={value}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(event) => onChange(event.target.value)}
        className="h-[34px] rounded-[8px] bg-[rgb(118_118_128/0.12)] px-2.5 text-[17px] text-ios-label outline-none"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label={clearLabel} className="grid size-8 place-items-center text-ios-label-secondary">
          <CircleX className="size-[18px] fill-current text-surface" aria-hidden="true" />
        </button>
      )}
    </label>
  );
}

/**
 * NativeCustomerFilterSheet on phones: a full-screen draft with Cancel, title and
 * condition count, inset-grouped sections and the Clear / Apply footer.
 */
export function MobileCustomerFilterScreen({
  filters,
  pageSize,
  onClose,
}: {
  filters: {
    q?: string;
    type?: string;
    owing?: boolean;
    createdFrom?: string;
    createdTo?: string;
    lastTxFrom?: string;
    lastTxTo?: string;
    totalFrom?: string;
    totalTo?: string;
    debtFrom?: string;
    debtTo?: string;
  };
  pageSize: number;
  onClose: () => void;
}) {
  const t = useTranslations("mobile.customers");
  const router = useRouter();
  const [draft, setDraft] = useState<CustomerFilterDraft>(() => ({
    type: filters.type ?? "",
    owing: Boolean(filters.owing),
    createdFrom: filters.createdFrom ?? "",
    createdTo: filters.createdTo ?? "",
    lastTxFrom: filters.lastTxFrom ?? "",
    lastTxTo: filters.lastTxTo ?? "",
    totalFrom: filters.totalFrom ?? "",
    totalTo: filters.totalTo ?? "",
    debtFrom: filters.debtFrom ?? "",
    debtTo: filters.debtTo ?? "",
  }));
  const update = (patch: Partial<CustomerFilterDraft>) => setDraft((current) => ({ ...current, ...patch }));

  function apply(event: FormEvent) {
    event.preventDefault();
    const query = new URLSearchParams({ tab: "customers", size: String(pageSize) });
    if (filters.q) query.set("q", filters.q);
    if (draft.type) query.set("type", draft.type);
    if (draft.owing) query.set("owing", "1");
    for (const key of ["createdFrom", "createdTo", "lastTxFrom", "lastTxTo", "totalFrom", "totalTo", "debtFrom", "debtTo"] as const) {
      if (draft[key]) query.set(key, draft[key]);
    }
    router.push(`${Routes.Partners}?${query.toString()}`);
    onClose();
  }

  const money = (value: number | null) => (value == null ? "" : String(value));

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t("filters.title")} className="fixed inset-0 z-[100] flex flex-col bg-canvas lg:hidden">
      <MobileFilterHeader title={t("filters.title")} conditionCount={filterDraftCount(draft)} onCancel={onClose} />
      <form onSubmit={apply} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-ios-section overflow-y-auto overscroll-contain px-4 pb-6 pt-1">
          <FilterSection title={t("filters.customerType")} mobileTitle="">
            <LumaWebPicker
              name="type"
              ariaLabel={t("filters.customerType")}
              rowLabel={t("filters.customerType")}
              value={draft.type || "all"}
              options={[
                { value: "all", label: t("filters.allTypes") },
                { value: "agent", label: t("tier.agent") },
                { value: "wholesale", label: t("tier.wholesale") },
                { value: "contractor", label: t("tier.contractor") },
                { value: "retail", label: t("tier.retail") },
              ]}
              onChange={(value) => update({ type: value === "all" ? "" : value })}
            />
          </FilterSection>
          <FilterSection title={t("filters.owing")}>
            <MobileSwitchRow label={t("filters.owingOnly")} checked={draft.owing} onChange={(owing) => update({ owing })} />
          </FilterSection>
          <FilterSection title={t("filters.createdDate")}>
            <OptionalDateRow label={t("filters.from")} value={draft.createdFrom} clearLabel={t("filters.clearDate")} onChange={(createdFrom) => update({ createdFrom })} />
            <OptionalDateRow label={t("filters.to")} value={draft.createdTo} clearLabel={t("filters.clearDate")} onChange={(createdTo) => update({ createdTo })} />
          </FilterSection>
          <FilterSection title={t("filters.lastTransaction")}>
            <OptionalDateRow label={t("filters.from")} value={draft.lastTxFrom} clearLabel={t("filters.clearDate")} onChange={(lastTxFrom) => update({ lastTxFrom })} />
            <OptionalDateRow label={t("filters.to")} value={draft.lastTxTo} clearLabel={t("filters.clearDate")} onChange={(lastTxTo) => update({ lastTxTo })} />
          </FilterSection>
          <FilterSection title={t("filters.totalSpent")}>
            <AmountRangeRows>
              <LabeledInput label={t("filters.minimum")} mobileLabel={t("filters.minimum")} value={draft.totalFrom} placeholder="0" suffix="đ" onChange={(value) => update({ totalFrom: money(value) })} />
              <LabeledInput label={t("filters.maximum")} mobileLabel={t("filters.maximum")} value={draft.totalTo} placeholder="0" suffix="đ" onChange={(value) => update({ totalTo: money(value) })} />
            </AmountRangeRows>
          </FilterSection>
          <FilterSection title={t("filters.currentDebt")}>
            <AmountRangeRows>
              <LabeledInput label={t("filters.minimum")} mobileLabel={t("filters.minimum")} value={draft.debtFrom} placeholder="0" suffix="đ" onChange={(value) => update({ debtFrom: money(value) })} />
              <LabeledInput label={t("filters.maximum")} mobileLabel={t("filters.maximum")} value={draft.debtTo} placeholder="0" suffix="đ" onChange={(value) => update({ debtTo: money(value) })} />
            </AmountRangeRows>
          </FilterSection>
        </div>
        <FilterDrawerFooter
          onClear={() => setDraft({ type: "", owing: false, createdFrom: "", createdTo: "", lastTxFrom: "", lastTxTo: "", totalFrom: "", totalTo: "", debtFrom: "", debtTo: "" })}
          invalid={false}
          pending={false}
          desktopApplyLabel={t("filters.apply")}
          mobileApplyLabel={t("filters.apply")}
          mobileClearLabel={t("filters.clear")}
        />
      </form>
    </div>,
    document.body,
  );
}
