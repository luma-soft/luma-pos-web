"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Banknote, Package, Pencil, SlidersHorizontal, Trash2, Truck, Undo2 } from "lucide-react";
import { MobileGroupedSection, MobilePushedScreen } from "@/components/mobile-pushed-screen";
import { SupplierCreateDialog } from "@/components/partners/supplier-create-dialog";
import {
  SupplierPayableActions,
  type SupplierPayableActionsHandle,
  type SupplierPayableOverview,
} from "@/components/partners/supplier-payable-actions";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { deleteSupplier } from "@/lib/actions/partners";
import { cn, formatCurrency } from "@/lib/utils";
import { LumaWebPicker } from "@/app/(app)/sales/tabs/filter-drawer-shared";
import { FilterDrawerFooter, FilterSection, MobileFilterHeader } from "@/app/(app)/sales/tabs/filter-drawer-sections";
import { LabeledRow, MenuAction, RowChevron, compactMoney } from "./customer-mobile";
import { CancelFinancialVoucherButton } from "@/components/partners/cancel-financial-voucher-button";
import {
  MobileHistoryContent,
  MobileHistoryRow,
  MobileLedgerContent,
  mobileLedgerDateTime,
} from "@/components/partners/partner-mobile-ledger";
import { Routes } from "@/lib/routes";

/**
 * Phone UI for the supplier list and profile, ported from SuppliersView.swift and
 * SupplierDetailView.swift. Desktop keeps the data table and preview modal.
 */

export type MobileSupplierSummary = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  currentDebt: string | number;
  totalPurchase?: string | number | null;
};

export type MobileSupplierProfile = {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  addressLine?: string;
  addressProvinceCode?: string;
  addressWardCode?: string;
  taxCode: string | null;
  note: string | null;
  currentDebt: string;
};

export type SupplierDebtFilterValue = "" | "owing" | "clear";

export type MobileSupplierActivity = {
  id: string;
  kind: "purchase" | "return";
  code: string;
  createdAt: string;
  total: number;
  status: string;
};

export type MobileSupplierLedgerRow = {
  id: string;
  kind: string;
  code: string;
  purchaseOrderId: string | null;
  createdAt: string;
  typeLabel: string;
  value: number;
  balance: number;
  reason: string | null;
  receiptId?: string | null;
  receiptStatus?: string | null;
  cancellationReason?: string | null;
};

/** NativeSupplierItemRow: truck tile, name, code · phone, compact purchases and debt. */
export function SupplierMobileRow({ supplier, onOpen }: { supplier: MobileSupplierSummary; onOpen: () => void }) {
  const t = useTranslations("mobile.suppliers");
  const debt = Number(supplier.currentDebt);
  const contact = [supplier.code, supplier.phone].map((part) => part?.trim()).filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-ios-inset py-2 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <span className="grid size-[42px] shrink-0 place-items-center rounded-[12px] bg-ios-accent/10 text-ios-accent">
        <Truck className="size-[22px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold leading-[22px] [overflow-wrap:anywhere]">{supplier.name}</span>
        <span className="mt-1 block truncate font-mono text-[12px] leading-4 text-ios-label-secondary">{contact || t("noContact")}</span>
      </span>
      <span className="flex min-h-[47px] shrink-0 flex-col items-end justify-center gap-0.5">
        <span className="text-[15px] font-bold tabular-nums text-ios-accent">{compactMoney(Number(supplier.totalPurchase ?? 0))}</span>
        {debt !== 0 && (
          <span className={cn("text-[15px] font-bold tabular-nums", debt > 0 ? "text-ios-red" : "text-ios-label-secondary")}>
            {debt > 0 ? t("debtBadge", { amount: compactMoney(debt) }) : compactMoney(debt)}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Supplier profile pushed on phones (SupplierDetailView): name and code, profile
 * fields, history and payables rows that push their own screens, and the "…" menu
 * (edit, pay debt, adjust debt, delete).
 */
export function MobileSupplierDetail({
  summary,
  profile,
  transactionCount,
  payables,
  loading,
  error,
  onBack,
  onChanged,
  history,
  debtLedger,
}: {
  summary: MobileSupplierSummary;
  profile: MobileSupplierProfile | null;
  transactionCount: number;
  payables: SupplierPayableOverview | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  history: MobileSupplierActivity[] | null;
  debtLedger: MobileSupplierLedgerRow[] | null;
}) {
  const t = useTranslations();
  const ts = useTranslations("mobile.suppliers");
  const tl = useTranslations("mobile.partnerLedger");
  const router = useRouter();
  const openDetail = useOpenDetailParam();
  const dialog = useConfirmDialog();
  const [route, setRoute] = useState<"history" | "debt" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const payablesRef = useRef<SupplierPayableActionsHandle>(null);
  const name = profile?.name ?? summary.name;
  const debt = Number(profile?.currentDebt ?? summary.currentDebt);
  const subtitle = [profile?.code ?? summary.code, profile?.phone ?? summary.phone].filter(Boolean).join(" · ");

  async function remove() {
    const ok = await dialog.confirm({
      title: ts("deleteTitle"),
      description: ts("deleteMessage"),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(true);
    const result = await deleteSupplier(summary.id);
    setDeleting(false);
    if (result.ok) {
      onBack();
      router.refresh();
      return;
    }
    await dialog.alert({ description: result.error.includes(".") ? t(result.error as never) : ts("deleteFailed") });
  }

  return (
    <MobilePushedScreen
      title={name}
      onBack={onBack}
      actions={profile && (
        <div className="space-y-2">
          <MenuAction icon={Pencil} label={ts("edit")} onSelect={() => setEditOpen(true)} />
          <MenuAction icon={Banknote} label={ts("collectDebt")} disabled={debt <= 0 || !payables} onSelect={() => payablesRef.current?.open("pay")} />
          <MenuAction icon={SlidersHorizontal} label={ts("adjustDebt")} disabled={!payables} onSelect={() => payablesRef.current?.open("adjust")} />
          <MenuAction icon={Trash2} label={ts("delete")} destructive disabled={deleting} onSelect={() => void remove()} />
        </div>
      )}
    >
      <div className="space-y-ios-section px-ios-inset pt-2">
        {error && (
          <MobileGroupedSection>
            <p className="px-4 py-[11px] text-[15px] text-ios-orange">{t(error as never)}</p>
          </MobileGroupedSection>
        )}
        <MobileGroupedSection>
          <div className="space-y-2 px-4 py-[16px]">
            <h2 className="text-[22px] font-bold leading-7 [overflow-wrap:anywhere]">{name}</h2>
            {subtitle && <p className="text-[15px] text-ios-label-secondary">{subtitle}</p>}
          </div>
        </MobileGroupedSection>

        {loading && !profile ? (
          <MobileGroupedSection>
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex min-h-11 items-center justify-between gap-4 px-4 py-[11px]" aria-hidden="true">
                <span className="h-3 w-20 rounded bg-black/[0.08] dark:bg-white/[0.1]" />
                <span className="h-3.5 w-28 rounded bg-black/[0.08] dark:bg-white/[0.1]" />
              </div>
            ))}
          </MobileGroupedSection>
        ) : profile && (profile.phone || profile.email || profile.taxCode || profile.address || profile.note) ? (
          <MobileGroupedSection title={ts("profile")}>
            {profile.phone && <LabeledRow label={ts("phone")} value={profile.phone} />}
            {profile.email && <LabeledRow label={ts("email")} value={profile.email} />}
            {profile.taxCode && <LabeledRow label={ts("taxCode")} value={profile.taxCode} />}
            {profile.address && <LabeledRow label={ts("address")} value={profile.address} />}
            {profile.note && <LabeledRow label={ts("note")} value={profile.note} />}
          </MobileGroupedSection>
        ) : null}

        <MobileGroupedSection>
          <button type="button" onClick={() => setRoute("history")} className="flex min-h-11 w-full items-center gap-1 py-[11px] pl-4 pr-2 text-left text-[17px] active:bg-black/[0.04]">
            <span className="min-w-0 flex-1">{ts("transactionHistory")}</span>
            <span className="text-[12px] text-ios-label-secondary">{ts("activityCount", { count: transactionCount })}</span>
            <RowChevron />
          </button>
          <button type="button" onClick={() => setRoute("debt")} className="flex min-h-11 w-full items-center gap-1 py-[11px] pl-4 pr-2 text-left text-[17px] active:bg-black/[0.04]">
            <span className="min-w-0 flex-1">{ts("payables")}</span>
            <span className={cn("text-[15px] tabular-nums", debt > 0 ? "text-ios-orange" : "text-ios-label")}>{formatCurrency(debt)}</span>
            <RowChevron />
          </button>
        </MobileGroupedSection>
      </div>

      {route === "history" && (
        <SupplierHistoryScreen name={name} activities={history ?? []} onBack={() => setRoute(null)} />
      )}
      {route === "debt" && (
        <MobilePushedScreen title={ts("payables")} onBack={() => setRoute(null)} layer={1}>
          <MobileLedgerContent
            partnerName={name}
            balance={payables?.currentDebt ?? debt}
            balanceLabel={tl("currentPayable")}
            balanceHeader={tl("currentDebt")}
            positiveTone="orange"
            beforeLedger={(
              <MobileGroupedSection title={tl("unpaidPurchases")}>
                {payables && payables.invoices.length > 0 ? payables.invoices.map((invoice) => (
                  <button key={invoice.id} type="button" onClick={() => openDetail("detailPurchaseId", invoice.id)} className="block w-full space-y-1 px-4 py-ios-row text-left active:bg-black/[0.04]">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-[15px] font-semibold">{tl("purchase")}</span>
                      <span className="text-[15px] tabular-nums">{formatCurrency(invoice.remaining)}</span>
                    </span>
                    <span className="block truncate text-[11px] text-ios-label-tertiary">{mobileLedgerDateTime(invoice.createdAt)} · {invoice.code}</span>
                  </button>
                )) : (
                  <p className="px-4 py-[11px] text-[13px] text-ios-label-secondary">{tl("noOpenInvoices")}</p>
                )}
              </MobileGroupedSection>
            )}
            entries={(debtLedger ?? []).map((row) => ({
              ...row,
              label: row.typeLabel,
              onOpen: row.purchaseOrderId ? () => openDetail("detailPurchaseId", row.purchaseOrderId!) : undefined,
              extra: row.kind === "payment" && row.receiptId && row.receiptStatus === "confirmed" ? (
                <CancelFinancialVoucherButton
                  kind="supplier"
                  receiptId={row.receiptId}
                  partyId={summary.id}
                  code={row.code}
                  amount={Math.abs(row.value)}
                  onCancelled={onChanged}
                />
              ) : undefined,
            }))}
            collectLabel={tl("collect")}
            adjustLabel={tl("adjust")}
            collectDisabled={debt <= 0 || !payables}
            onCollect={() => payablesRef.current?.open("pay")}
            onAdjust={() => payablesRef.current?.open("adjust")}
          />
        </MobilePushedScreen>
      )}

      {profile && (
        <SupplierCreateDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          editingId={profile.id}
          initialValues={{
            name: profile.name,
            phone: profile.phone ?? "",
            email: profile.email ?? "",
            address: profile.address ?? "",
            addressLine: profile.addressLine || profile.address || "",
            addressProvinceCode: profile.addressProvinceCode ?? "",
            addressWardCode: profile.addressWardCode ?? "",
            taxCode: profile.taxCode ?? "",
            note: profile.note ?? "",
          }}
          onCreated={() => {
            setEditOpen(false);
            void onChanged();
          }}
        />
      )}
      {payables && (
        // Portalled so the dialogs also cover screens pushed above this one.
        createPortal(<SupplierPayableActions hideTriggers handleRef={payablesRef} supplierId={summary.id} overview={payables} onChanged={onChanged} />, document.body)
      )}
    </MobilePushedScreen>
  );
}

/** Opens a URL-owned detail overlay (purchase) above the pushed screens. */
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

/** SupplierHistoryView: search, net purchase summary and day sections. */
function SupplierHistoryScreen({ name, activities, onBack }: { name: string; activities: MobileSupplierActivity[]; onBack: () => void }) {
  const tl = useTranslations("mobile.partnerLedger");
  const ts = useTranslations("mobile.suppliers");
  const router = useRouter();
  const openDetail = useOpenDetailParam();
  const purchaseCount = activities.filter((activity) => activity.kind === "purchase" && activity.status !== "cancelled").length;
  const items = activities.map((activity) => {
    const isReturn = activity.kind === "return";
    return {
      id: `${activity.kind}-${activity.id}`,
      createdAt: activity.createdAt,
      net: isReturn ? -activity.total : activity.total,
      searchText: activity.code,
      row: (
        <MobileHistoryRow
          label={`${name} · ${activity.code}`}
          onOpen={isReturn
            ? () => router.push(`${Routes.PurchaseReturns}?q=${encodeURIComponent(activity.code)}`)
            : () => openDetail("detailPurchaseId", activity.id)}
        >
          <span className={cn("flex w-[34px] shrink-0 justify-center", isReturn ? "text-ios-orange" : "text-ios-accent")}>
            {isReturn ? <Undo2 className="size-5" aria-hidden="true" /> : <Package className="size-5" aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block text-[15px] font-semibold">{tl(isReturn ? "purchaseReturn" : "purchase")}</span>
            <span className="block truncate text-[11px] text-ios-label-tertiary">{mobileLedgerDateTime(activity.createdAt)} · {activity.code}</span>
          </span>
          <span className={cn("shrink-0 text-[15px] tabular-nums", isReturn && "text-ios-orange")}>{formatCurrency(activity.total)}</span>
        </MobileHistoryRow>
      ),
    };
  });
  return (
    <MobilePushedScreen
      title={(
        <span className="block leading-tight">
          <span className="block truncate text-[17px] font-semibold">{ts("transactionHistory")}</span>
          <span className="block truncate text-[12px] font-normal text-ios-label-secondary">{tl("purchaseCount", { count: purchaseCount })}</span>
        </span>
      )}
      onBack={onBack}
      layer={1}
      className="bg-surface"
    >
      <MobileHistoryContent
        items={items}
        icon={<Package className="size-5" strokeWidth={2.4} aria-hidden="true" />}
        netLabel={tl("supplierNet")}
        searchPlaceholder={tl("supplierSearch")}
      />
    </MobilePushedScreen>
  );
}

/**
 * NativeSuppliersFilterView: full-screen debt filter with Cancel, title and count,
 * one inline picker row, and the Clear / Apply footer.
 */
export function MobileSupplierFilterScreen({
  value,
  onApply,
  onClose,
}: {
  value: SupplierDebtFilterValue;
  onApply: (value: SupplierDebtFilterValue) => void;
  onClose: () => void;
}) {
  const t = useTranslations("mobile.suppliers");
  const [draft, setDraft] = useState<SupplierDebtFilterValue>(value);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t("debtFilter")} className="fixed inset-0 z-[100] flex flex-col bg-canvas lg:hidden">
      <MobileFilterHeader title={t("debtFilter")} conditionCount={draft ? 1 : 0} onCancel={onClose} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 space-y-ios-section overflow-y-auto overscroll-contain px-4 pb-6 pt-1">
          <FilterSection title={t("debtFilter")} mobileTitle="">
            <LumaWebPicker
              name="owing"
              ariaLabel={t("debtFilter")}
              rowLabel={t("debtFilter")}
              value={draft || "all"}
              options={[
                { value: "all", label: t("all") },
                { value: "owing", label: t("owing") },
                { value: "clear", label: t("clear") },
              ]}
              onChange={(next) => setDraft(next === "all" ? "" : (next as SupplierDebtFilterValue))}
            />
          </FilterSection>
        </div>
        <FilterDrawerFooter
          onClear={() => setDraft("")}
          invalid={false}
          pending={false}
          desktopApplyLabel={t("apply")}
          mobileApplyLabel={t("apply")}
          mobileClearLabel={t("resetFilters")}
        />
      </form>
    </div>,
    document.body,
  );
}
