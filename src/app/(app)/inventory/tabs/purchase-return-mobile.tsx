"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Package, Pencil, Printer, Trash2 } from "lucide-react";
import { MobileGroupedSection, MobilePushedScreen } from "@/components/mobile-pushed-screen";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { mobileLedgerDateTime } from "@/components/partners/partner-mobile-ledger";
import { LabeledRow, MenuAction } from "@/app/(app)/partners/tabs/customer-mobile";
import { deletePurchaseReturn } from "@/lib/actions/purchase-returns";
import { productLineDisplayName } from "@/lib/products/variant-presentation";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { getPurchaseReturns } from "@/lib/data/purchase-returns";
import { SHOW_WAREHOUSE } from "@/lib/inventory/warehouse-visibility";

export type PurchaseReturnRow = Awaited<ReturnType<typeof getPurchaseReturns>>["rows"][number];

function shortDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Badge({ label, tone }: { label: string; tone: "green" | "orange" }) {
  return (
    <span className={cn(
      "inline-flex rounded-full px-2 py-[5px] text-[11px] font-semibold leading-none",
      tone === "green" ? "bg-ios-green/12 text-ios-green" : "bg-ios-orange/12 text-ios-orange",
    )}>
      {label}
    </span>
  );
}

/** NativePurchaseReturnRowView: box tile, supplier, red refund, date · code, items, badges, debt. */
export function PurchaseReturnMobileRow({ row, onOpen }: { row: PurchaseReturnRow; onOpen: () => void }) {
  const t = useTranslations("mobile.purchaseReturns");
  const debt = Number(row.debtAmount);
  return (
    <button type="button" onClick={onOpen} aria-label={`${row.supplierName ?? ""} · ${row.code}`} className="flex w-full items-start gap-3 px-4 py-ios-row text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]">
      <span className="grid size-[42px] shrink-0 place-items-center rounded-[13px] bg-ios-accent/10 text-ios-accent">
        <Package className="size-[19px]" strokeWidth={2.4} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 space-y-[7px]">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[17px] font-bold leading-[22px]">{row.supplierName}</span>
          <span className="shrink-0 text-[15px] font-bold tabular-nums text-ios-red">{formatCurrency(Number(row.totalRefund))}</span>
          <ChevronRight className="size-3.5 shrink-0 self-center text-ios-label-tertiary" strokeWidth={2.6} aria-hidden="true" />
        </span>
        <span className="block truncate text-[11px] text-ios-label-tertiary">{shortDate(row.createdAt)} · {row.code}</span>
        <span className="block text-[12px] text-ios-label-secondary">{t("itemCount", { count: row.items.length })}</span>
        <span className="flex flex-wrap gap-[7px]">
          <Badge label={t(`status.${row.status}` as never)} tone="green" />
          <Badge label={t(`status.${row.settlementStatus}` as never)} tone={row.settlementStatus === "settled" ? "green" : "orange"} />
        </span>
        {debt > 0 && <span className="block text-right text-[12px] font-medium tabular-nums text-ios-label-secondary">{t("debtAmount")} {formatCurrency(debt)}</span>}
      </span>
    </button>
  );
}

function linePricing(item: PurchaseReturnRow["items"][number]) {
  const unitCost = Number(item.unitCost);
  const quantity = Number(item.quantity);
  const sourceQuantity = Number(item.sourceQuantity ?? 0);
  const sourceMultiplier = Number(item.sourceUnitMultiplier) || 1;
  const returnMultiplier = Number(item.unitMultiplier) || 1;
  const discountPerUnit = !item.purchaseOrderItemId || sourceQuantity <= 0
    ? 0
    : item.sourceDiscountMode === "pct" && item.sourceDiscountInput != null
      ? unitCost * Number(item.sourceDiscountInput) / 100
      : Number(item.sourceDiscount ?? 0) / sourceQuantity * returnMultiplier / sourceMultiplier;
  return {
    discount: Math.max(0, Math.min(unitCost, discountPerUnit)) * quantity,
    unitCostAfterDiscount: Math.max(0, unitCost - discountPerUnit),
  };
}

/** PurchaseReturnDetailView pushed on phones. */
export function MobilePurchaseReturnDetail({
  row,
  capabilities,
  onBack,
}: {
  row: PurchaseReturnRow;
  capabilities?: { canEdit: boolean; canDelete: boolean };
  onBack: () => void;
}) {
  const t = useTranslations("mobile.purchaseReturns");
  const tRoot = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const catalog = useProductCatalog();

  async function remove() {
    const ok = await dialog.confirm({
      title: t("deleteTitle", { code: row.code }),
      description: t("deleteMessage"),
      confirmLabel: t("delete"),
      variant: "destructive",
    });
    if (!ok) return;
    const result = await deletePurchaseReturn(row.id);
    if (!result.ok) {
      await dialog.alert({ description: tRoot(result.error as never), variant: "destructive" });
      return;
    }
    void catalog.refresh();
    onBack();
    router.refresh();
  }

  return (
    <MobilePushedScreen
      title={row.code}
      onBack={onBack}
      layer={2}
      actions={(
        <div className="space-y-2">
          <MenuAction icon={Printer} label={t("print")} onSelect={() => router.push(`/purchase-returns/${row.id}/print`)} />
          {capabilities?.canEdit && <MenuAction icon={Pencil} label={t("edit")} onSelect={() => router.push(`/purchase-returns/${row.id}/edit`)} />}
          {capabilities?.canDelete && <MenuAction icon={Trash2} label={t("delete")} destructive onSelect={() => void remove()} />}
        </div>
      )}
    >
      <div className="space-y-ios-section px-ios-inset pt-2">
        <MobileGroupedSection title={t("info")}>
          <LabeledRow label={t("statusLabel")} value={t(`status.${row.status}` as never)} />
          <LabeledRow label={t("settlement")} value={t(`status.${row.settlementStatus}` as never)} />
          <LabeledRow label={t("supplier")} value={row.supplierName ?? "—"} />
          {SHOW_WAREHOUSE && <LabeledRow label={t("warehouse")} value={row.warehouseName ?? "—"} />}
          <LabeledRow label={t("createdAt")} value={mobileLedgerDateTime(row.createdAt)} />
        </MobileGroupedSection>

        <MobileGroupedSection title={t("items", { count: row.items.length })}>
          {row.items.map((item) => {
            const pricing = linePricing(item);
            return (
              <Link key={item.id} href={Routes.product(item.productId)} className="block space-y-[5px] px-4 py-ios-row active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                <span className="flex items-baseline gap-2">
                  <span className="line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold">{productLineDisplayName(item)}</span>
                  <span className="shrink-0 text-[15px] tabular-nums">{formatCurrency(Number(item.total))}</span>
                </span>
                <span className="block text-[12px] text-ios-label-secondary">
                  {item.sku} · {formatNumber(Number(item.quantity))} {item.unitName} × {formatCurrency(Number(item.returnUnitCost))}
                </span>
                {pricing.discount > 0 && <span className="block text-[11px] text-ios-label-secondary">{t("discount")}: {formatCurrency(pricing.discount)}</span>}
                <span className="block text-[11px] text-ios-label-secondary">{t("unitAfterDiscount")}: {formatCurrency(pricing.unitCostAfterDiscount)}</span>
              </Link>
            );
          })}
        </MobileGroupedSection>

        <MobileGroupedSection title={t("payment")}>
          <LabeledRow label={t("subtotal")} value={formatCurrency(Number(row.subtotal))} />
          {Number(row.discount) > 0 && <LabeledRow label={t("discount")} value={formatCurrency(Number(row.discount))} />}
          {Number(row.vatRate) > 0 && <LabeledRow label={t("vatRate")} value={`${formatNumber(Number(row.vatRate))}%`} />}
          {Number(row.tax) > 0 && <LabeledRow label={t("tax")} value={formatCurrency(Number(row.tax))} />}
          <div className="[&_span]:font-semibold"><LabeledRow label={t("totalRefund")} value={formatCurrency(Number(row.totalRefund))} /></div>
          <LabeledRow label={t("refundAmount")} value={formatCurrency(Number(row.refundAmount))} />
          {row.refundMethod && <LabeledRow label={t("refundMethod")} value={tRoot(`purchaseReturns.refundMethods.${row.refundMethod}` as never)} />}
          <LabeledRow label={t("debtAmount")} value={formatCurrency(Number(row.debtAmount))} />
          {row.note && <LabeledRow label={t("note")} value={row.note} />}
        </MobileGroupedSection>
      </div>
    </MobilePushedScreen>
  );
}
