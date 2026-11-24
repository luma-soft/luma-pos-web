"use client";

import { FitText } from "@/components/fit-text";
import { ProductRecordLink } from "@/components/product-record-link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronRight, Pencil, Printer, Trash2 } from "lucide-react";
import { MobileGroupedSection, MobilePushedScreen } from "@/components/mobile-pushed-screen";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { mobileLedgerDateTime } from "@/components/partners/partner-mobile-ledger";
import { LabeledRow, MenuAction } from "@/app/(app)/partners/tabs/customer-mobile";
import { approveInternalUse, deleteInternalUse } from "@/lib/actions/internal-use";
import { internalUseReasonLabel } from "@/lib/inventory/internal-use-reason";
import { productLineDisplayName } from "@/lib/products/variant-presentation";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type { getInternalUseIssues } from "@/lib/data/internal-use";
import { SHOW_WAREHOUSE } from "@/lib/inventory/warehouse-visibility";

export type InternalUseRow = Awaited<ReturnType<typeof getInternalUseIssues>>[number];
type Capabilities = { canEdit: boolean; canDelete: boolean; canApprovePending?: boolean };

function statusKey(status: string) {
  return status === "draft" ? "draft" : status === "pending" ? "pending" : "approved";
}

/** InternalUseView row: department/warehouse/reason title, metadata, items · cost, date · code, status. */
export function InternalUseMobileRow({ row, onOpen }: { row: InternalUseRow; onOpen: () => void }) {
  const t = useTranslations("mobile.internalUse");
  const locale = useLocale();
  const department = row.department?.trim() || null;
  const warehouse = row.warehouseName?.trim() || null;
  const reason = row.reason?.trim() ? internalUseReasonLabel(row.reason, locale) : null;
  const title = department ?? warehouse ?? reason ?? t("documentType");
  const metadata = [warehouse, reason].filter((value): value is string => Boolean(value) && value !== title);
  const key = statusKey(row.status);
  return (
    <button type="button" onClick={onOpen} aria-label={`${title} · ${row.code}`} className="flex w-full items-start gap-3 px-4 py-ios-row text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]">
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="block truncate text-[17px] font-semibold leading-[22px]">{title}</span>
        {metadata.length > 0 && <span className="block truncate text-[15px] text-ios-label-secondary">{metadata.join(" · ")}</span>}
        <span className="block text-[12px] text-ios-label-secondary">{t("itemCountAndCost", { count: row.itemCount, cost: formatCurrency(row.totalCost) })}</span>
        <span className="block truncate text-[11px] text-ios-label-tertiary">{mobileLedgerDateTime(row.createdAt)} · {row.code}</span>
      </span>
      <span className={cn("shrink-0 text-[12px] font-semibold", key === "approved" ? "text-ios-green" : "text-ios-orange")}>{t(`status.${key}`)}</span>
      <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-ios-label-tertiary" strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
}

/** InternalUseDetailView pushed on phones. */
export function MobileInternalUseDetail({ row, capabilities, onBack }: { row: InternalUseRow; capabilities?: Capabilities; onBack: () => void }) {
  const t = useTranslations("mobile.internalUse");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const catalog = useProductCatalog();
  const key = statusKey(row.status);
  const canComplete = Boolean(capabilities?.canEdit) && (row.status === "draft" || (row.status === "pending" && capabilities?.canApprovePending));
  const totalQuantity = row.items.reduce((sum, item) => sum + Number(item.quantity), 0);

  async function complete() {
    if (!await dialog.confirm({ title: t("completeTitle", { code: row.code }), description: t("completeMessage"), confirmLabel: t("complete") })) return;
    const result = await approveInternalUse(row.id);
    if (!result.ok) return void dialog.alert({ description: tRoot(result.error as never), variant: "destructive" });
    void catalog.refresh();
    router.refresh();
  }

  async function remove() {
    const issued = row.status !== "draft" && row.status !== "pending";
    if (!await dialog.confirm({ title: t("deleteTitle", { code: row.code }), description: t(issued ? "deleteIssued" : "deleteUnissued"), confirmLabel: t("delete"), variant: "destructive" })) return;
    const result = await deleteInternalUse(row.id);
    if (!result.ok) return void dialog.alert({ description: tRoot(result.error as never), variant: "destructive" });
    void catalog.refresh();
    onBack();
    router.refresh();
  }

  return (
    <MobilePushedScreen
      title={row.code}
      onBack={onBack}
      actions={(
        <div className="space-y-2">
          <MenuAction icon={Printer} label={t("print")} onSelect={() => router.push(`/internal-use/${row.id}/print`)} />
          {canComplete && <MenuAction icon={Check} label={t("complete")} onSelect={() => void complete()} />}
          {capabilities?.canEdit && <MenuAction icon={Pencil} label={t("edit")} onSelect={() => router.push(`/internal-use/${row.id}/edit`)} />}
          {capabilities?.canDelete && <MenuAction icon={Trash2} label={t("delete")} destructive onSelect={() => void remove()} />}
        </div>
      )}
    >
      <div className="space-y-ios-section px-ios-inset pt-2">
        <MobileGroupedSection title={t("details")}>
          <LabeledRow label={t("statusLabel")} value={t(`status.${key}`)} />
          {SHOW_WAREHOUSE && <LabeledRow label={t("warehouse")} value={row.warehouseName ?? "—"} />}
          {row.department && <LabeledRow label={t("department")} value={row.department} />}
          {row.reason && <LabeledRow label={t("reason")} value={internalUseReasonLabel(row.reason, locale)} />}
          <LabeledRow label={t("createdAt")} value={mobileLedgerDateTime(row.createdAt)} />
          {row.note && <LabeledRow label={t("note")} value={row.note} />}
        </MobileGroupedSection>

        <MobileGroupedSection title={t("items", { count: row.items.length })}>
          {row.items.map((item) => (
            <ProductRecordLink key={item.id} productId={item.productId} deleted={item.productDeleted} className="block space-y-[5px] px-4 py-ios-row" linkClassName="active:bg-black/[0.04] dark:active:bg-white/[0.06]">
              <span className="flex items-baseline gap-2">
                <FitText className="line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold">{productLineDisplayName(item)}</FitText>
                <span className="shrink-0 text-[15px] tabular-nums">{formatCurrency(item.total)}</span>
              </span>
              <span className="block text-[12px] text-ios-label-secondary">
                {item.sku ?? "—"} · {formatNumber(item.quantity)} {item.unitName} × {formatCurrency(item.unitCost)}
              </span>
            </ProductRecordLink>
          ))}
        </MobileGroupedSection>

        <MobileGroupedSection title={t("summary")}>
          <LabeledRow label={t("totalQuantity")} value={formatNumber(totalQuantity)} />
          <LabeledRow label={t("totalCost")} value={formatCurrency(row.totalCost)} />
        </MobileGroupedSection>
      </div>
    </MobilePushedScreen>
  );
}
