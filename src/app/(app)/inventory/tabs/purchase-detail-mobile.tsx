"use client";

import { FitText } from "@/components/fit-text";
import { ProductRecordLink } from "@/components/product-record-link";
import { isDeletedProductName } from "@/lib/products/deleted-product";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, Pencil, Printer, Undo2, XCircle } from "lucide-react";
import { MobileGroupedSection, MobilePushedScreen } from "@/components/mobile-pushed-screen";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { mobileLedgerDateTime } from "@/components/partners/partner-mobile-ledger";
import { LabeledRow, MenuAction } from "@/app/(app)/partners/tabs/customer-mobile";
import { cancelPurchase } from "@/lib/actions/purchases";
import { productLineDisplayName } from "@/lib/products/variant-presentation";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { purchaseOwed, type PurchaseRow } from "./purchase-detail-modal";
import { SHOW_WAREHOUSE } from "@/lib/inventory/warehouse-visibility";

/**
 * Purchase receipt pushed on phones (PurchaseReceiptDetailView): receipt info,
 * items, payment, and the "…" menu (print, copy, supplier return, edit, cancel).
 */
export function MobilePurchaseDetail({ purchase, onBack }: { purchase: PurchaseRow; onBack: () => void }) {
  const t = useTranslations("mobile.purchases");
  const td = useTranslations("mobile.purchases.detail");
  const tRoot = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const canChange = purchase.status === "received" || purchase.status === "draft";
  const canReturn = purchase.status === "received" || purchase.status === "returned";
  const blockedByReturn = purchase.hasReturns || purchase.status === "returned";
  const warehouseName = "warehouseName" in purchase ? purchase.warehouseName : null;
  const shippingFee = "shippingFee" in purchase ? Number(purchase.shippingFee ?? 0) : 0;

  async function cancel() {
    const ok = await dialog.confirm({
      title: td("cancelTitle", { code: purchase.code }),
      description: td("cancelHint"),
      confirmLabel: td("cancel"),
      variant: "destructive",
    });
    if (!ok) return;
    const result = await cancelPurchase(purchase.id);
    if (result.ok) router.refresh();
    else await dialog.alert({ description: tRoot(result.error as never), variant: "destructive" });
  }

  return (
    <MobilePushedScreen
      title={purchase.code}
      onBack={onBack}
      // Also opened from supplier history/payables screens, so stack above them.
      layer={2}
      actions={(
        <div className="space-y-2">
          <MenuAction icon={Printer} label={td("print")} onSelect={() => router.push(`${Routes.purchase(purchase.id)}/print`)} />
          {canChange && <MenuAction icon={Copy} label={td("copy")} onSelect={() => router.push(Routes.purchaseCopy(purchase.id))} />}
          {canReturn && (
            <MenuAction
              icon={Undo2}
              label={td("createReturn")}
              onSelect={() => purchase.hasRemainingReturnQuantity
                ? router.push(`${Routes.PurchaseReturns}/new?purchaseOrderId=${encodeURIComponent(purchase.id)}`)
                : void dialog.alert({ description: td("fullyReturned") })}
            />
          )}
          {(canChange || blockedByReturn) && (
            <MenuAction
              icon={Pencil}
              label={td("edit")}
              onSelect={() => blockedByReturn
                ? void dialog.alert({ description: td("editBlocked") })
                : router.push(Routes.purchaseEdit(purchase.id))}
            />
          )}
          {canChange && <MenuAction icon={XCircle} label={td("cancel")} destructive onSelect={() => void cancel()} />}
        </div>
      )}
    >
      <div className="space-y-ios-section px-ios-inset pt-2">
        <MobileGroupedSection title={td("info")}>
          <LabeledRow label={td("statusLabel")} value={t(`status.${purchase.status}` as never)} />
          <LabeledRow label={td("date")} value={mobileLedgerDateTime(purchase.createdAt)} />
          <LabeledRow label={td("supplier")} value={purchase.supplierName ?? "—"} />
          {SHOW_WAREHOUSE && warehouseName && <LabeledRow label={td("warehouse")} value={warehouseName} />}
          {purchase.invoiceNumber && <LabeledRow label={td("invoiceNumber")} value={purchase.invoiceNumber} />}
          {purchase.createdByName && <LabeledRow label={td("createdBy")} value={purchase.createdByName} />}
        </MobileGroupedSection>

        <MobileGroupedSection title={td("items", { count: purchase.items.length })}>
          {purchase.items.length === 0 && <p className="px-4 py-6 text-center text-[15px] text-ios-label-secondary">{td("noItems")}</p>}
          {purchase.items.map((item) => {
            const quantity = Number(item.quantity);
            const discount = Number(item.discount);
            const discountPct = "discountMode" in item && item.discountMode === "pct" && item.discountInput != null
              ? `${formatNumber(Number(item.discountInput))}% · `
              : "";
            return (
              <ProductRecordLink
                key={item.id}
                productId={item.productId}
                deleted={isDeletedProductName(item.productName)}
                className="block space-y-[5px] px-4 py-ios-row"
                linkClassName="active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <span className="flex items-baseline gap-2">
                  <FitText className="line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold">{productLineDisplayName(item)}</FitText>
                  <span className="shrink-0 text-[15px] tabular-nums">{formatCurrency(Number(item.total))}</span>
                </span>
                <span className="block text-[12px] text-ios-label-secondary">
                  {item.sku} · {formatNumber(quantity)} {item.baseUnit} × {formatCurrency(Number(item.unitCost))}
                </span>
                {discount > 0 && (
                  <span className="block text-[11px] text-ios-label-secondary">{td("discount")}: {discountPct}{formatCurrency(discount)}</span>
                )}
                <span className="block text-[11px] text-ios-label-secondary">
                  {td("unitAfterDiscount")}: {formatCurrency(quantity > 0 ? Number(item.total) / quantity : Number(item.unitCost))}
                </span>
              </ProductRecordLink>
            );
          })}
        </MobileGroupedSection>

        <MobileGroupedSection title={td("payment")}>
          <LabeledRow label={td("subtotal")} value={formatCurrency(Number(purchase.subtotal))} />
          {Number(purchase.discount) > 0 && <LabeledRow label={td("discount")} value={formatCurrency(Number(purchase.discount))} />}
          {shippingFee > 0 && <LabeledRow label={td("shipping")} value={formatCurrency(shippingFee)} />}
          {Number(purchase.vatRate) > 0 && <LabeledRow label="VAT" value={`${formatNumber(Number(purchase.vatRate))}%`} />}
          {Number(purchase.tax) > 0 && <LabeledRow label={td("tax")} value={formatCurrency(Number(purchase.tax))} />}
          <div className={cn("[&_span]:font-semibold")}>
            <LabeledRow label={td("total")} value={formatCurrency(Number(purchase.total))} />
          </div>
          <LabeledRow label={td("paid")} value={formatCurrency(Number(purchase.amountPaid))} />
          <LabeledRow label={td("owedLabel")} value={formatCurrency(purchaseOwed(purchase))} />
          {purchase.note && <LabeledRow label={td("note")} value={purchase.note} />}
        </MobileGroupedSection>
      </div>
    </MobilePushedScreen>
  );
}
