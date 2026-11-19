"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Banknote, Ban, ChevronRight, Pencil, Phone, SlidersHorizontal, UserRound } from "lucide-react";
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
  salesHistory: Array<{ status?: string | null }>;
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

/** LumaListTotalsCard with centred metrics separated by hairlines. */
export function MobileListTotalsCard({ metrics }: { metrics: Array<{ id: string; title: string; value: string; tone?: string }> }) {
  return (
    <div className="mx-ios-inset mb-1.5 flex items-start rounded-[8px] bg-surface px-3.5 py-3 lg:hidden">
      {metrics.map((metric, index) => (
        <div key={metric.id} className="contents">
          {index > 0 && <span className="mx-2.5 mt-2 h-[38px] w-px shrink-0 bg-black/[0.08] dark:bg-white/[0.08]" aria-hidden="true" />}
          <div className="min-w-0 flex-1 text-center">
            <div className="flex h-[34px] items-start justify-center text-[12px] leading-4 text-ios-label-secondary">{metric.title}</div>
            <div className={cn("mt-[5px] whitespace-nowrap text-[clamp(10px,3vw,13px)] font-semibold tabular-nums", metric.tone)}>{metric.value}</div>
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

function RowChevron() {
  return <ChevronRight className="size-[18px] shrink-0 text-ios-label-tertiary" strokeWidth={2.6} aria-hidden="true" />;
}

function LabeledRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-[11px] text-[17px]">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 text-right text-ios-label-secondary [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

function MenuAction({ icon: Icon, label, onSelect, disabled, destructive }: { icon: typeof Pencil; label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean }) {
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
  salesHistory,
  debtLedger,
}: {
  customer: MobileCustomer;
  onBack: () => void;
  /** Existing history/debt panels shown in the pushed sub-screens. */
  salesHistory: ReactNode;
  debtLedger: ReactNode;
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
        <MobilePushedScreen title={t("transactionHistory")} onBack={() => setRoute(null)} layer={1}>
          <div className="px-ios-inset pt-2">{salesHistory}</div>
        </MobilePushedScreen>
      )}
      {route === "debt" && (
        <MobilePushedScreen title={t("currentDebt")} onBack={() => setRoute(null)} layer={1}>
          <div className="px-ios-inset pt-2">{debtLedger}</div>
        </MobilePushedScreen>
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
      <CustomerReceivableActions hideTriggers handleRef={receivablesRef} customerId={customer.id} currentDebt={debt} />
    </MobilePushedScreen>
  );
}
