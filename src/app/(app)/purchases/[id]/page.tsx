import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Copy, FilePenLine, ReceiptText } from "lucide-react";
import { Routes } from "@/lib/routes";
import { MobileDetailHeader } from "@/components/mobile-detail-header";
import { MobileRecordCard, MobileRecordField } from "@/components/mobile-ui";
import { PurchaseDetailActionGroup } from "@/components/purchase-detail-action-group";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { getPurchase } from "@/lib/data/inventory";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import { Text } from "@/components/ui/text";
import { PurchaseCancelButton } from "./purchase-actions";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { PrintTemplateMenu } from "@/components/print/print-template-menu";
import { requireStoreContext } from "@/lib/auth/store-context";

function statusClass(status: string) {
  if (status === "cancelled") return "bg-er-soft text-er";
  if (status === "returned") return "bg-warn-soft text-warn";
  if (status === "draft") return "bg-warn-soft text-warn";
  return "bg-ok-soft text-ok";
}

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireStoreContext();
  const t = await getTranslations();
  const purchase = await getPurchase(context.storeId, id).catch(() => null);
  if (!purchase) notFound();

  const total = Number(purchase.total);
  const paid = Number(purchase.amountPaid);
  const owed = purchase.status === "cancelled" ? 0 : Math.max(0, total - paid);
  const canChange = purchase.status === "received" || purchase.status === "draft";
  const printTemplates = await getPrintTemplatesForDoc(context.storeId, "purchase");

  const printHref = `${Routes.purchase(purchase.id)}/print`;
  const copyHref = Routes.purchaseCopy(purchase.id);
  const editHref = Routes.purchaseEdit(purchase.id);

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <MobileDetailHeader
        backHref={Routes.Purchases}
        backLabel={t("common.back")}
        title={purchase.code}
        subtitle={formatDate(purchase.createdAt)}
        badge={<span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass(purchase.status))}>{t(`purchases.status.${purchase.status}` as never)}</span>}
      />
      <PurchaseDetailActionGroup label={t("common.actions")} className="-mt-3 mb-5">
          <PrintTemplateMenu baseHref={printHref} templates={printTemplates} label={t("print.printBtn")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11")} />
          {canChange && (
            <>
              <Link href={copyHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11")}>
                <Copy className="h-4 w-4" />
                {t("purchases.copy")}
              </Link>
              <Link href={editHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11")}>
                <FilePenLine className="h-4 w-4" />
                {t("purchases.edit")}
              </Link>
              <PurchaseCancelButton purchaseId={purchase.id} className="min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background" />
            </>
          )}
      </PurchaseDetailActionGroup>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div>
                <Text as="h2" weight="semibold" text={t("purchases.detail.items", { count: purchase.items.length })} />
                <p className="text-xs"><PartnerDetailLink kind="supplier" partnerId={purchase.supplierId} name={purchase.supplierName} /></p>
              </div>
              <ReceiptText className="h-5 w-5 text-slate-400" />
            </div>
            {purchase.items.length > 0 && (
              <div className="space-y-2 p-3 lg:hidden">
                {purchase.items.map((item) => {
                  const discount = Number(item.discount);
                  return (
                    <MobileRecordCard
                      key={item.id}
                      title={(
                        <Link
                          href={Routes.product(item.productId)}
                          className="inline-flex min-h-11 min-w-11 max-w-full items-center rounded-md text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                        >
                          <span className="truncate">{item.productName}</span>
                        </Link>
                      )}
                      subtitle={item.sku}
                    >
                      <MobileRecordField
                        label={`${t("purchases.cols.qty")} / ${t("purchases.cols.unit")}`}
                        value={`${formatNumber(Number(item.quantity))} ${item.baseUnit}`}
                      />
                      <MobileRecordField label={t("purchases.cols.unitCost")} value={formatCurrency(Number(item.unitCost))} />
                      <MobileRecordField
                        label={t("purchases.cols.discount")}
                        value={discount > 0 ? formatCurrency(discount) : "—"}
                      />
                      <MobileRecordField label={t("purchases.cols.lineTotal")} value={formatCurrency(Number(item.total))} />
                    </MobileRecordCard>
                  );
                })}
              </div>
            )}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                    <th className="px-4 py-2.5 font-semibold">{t("products.fields.sku")}</th>
                    <th className="px-4 py-2.5 font-semibold">{t("orders.cols.product")}</th>
                    <th className="px-4 py-2.5 font-semibold text-right">{t("purchases.cols.qty")}</th>
                    <th className="px-4 py-2.5 font-semibold text-right">{t("purchases.cols.unitCost")}</th>
                    <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.discount")}</th>
                    <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-soft">
                  {purchase.items.map((item) => {
                    const discount = Number(item.discount);
                    return (
                      <tr key={item.id}>
                        <td className="px-4 py-3">
                          <Link href={Routes.product(item.productId)} className="font-medium text-primary-600 hover:underline">
                            {item.sku}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-xs text-slate-400">{item.baseUnit}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNumber(Number(item.quantity))}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(Number(item.unitCost))}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                          {discount > 0 ? formatCurrency(discount) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(item.total))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {purchase.note && (
              <div className="px-4 py-3 border-t border-border text-sm">
                <Text as="div" variant="muted" size="xs" weight="medium" className="mb-1" text={t("purchases.detail.note")} />
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{purchase.note}</p>
              </div>
            )}
          </div>

          {canChange && (
            <div className="rounded-card border border-border bg-surface p-3">
              <PurchaseDetailActionGroup label={t("common.actions")}>
                <PurchaseCancelButton purchaseId={purchase.id} className="min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background" />
                <Link href={copyHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11")}>
                  <Copy className="h-4 w-4" />
                  {t("purchases.copy")}
                </Link>
                <PrintTemplateMenu baseHref={printHref} templates={printTemplates} label={t("print.printBtn")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11")} />
                <Link href={editHref} className={cn(buttonVariants({ variant: "default", size: "sm" }), "min-h-11")}>
                  <FilePenLine className="h-4 w-4" />
                  {t("purchases.edit")}
                </Link>
              </PurchaseDetailActionGroup>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-card p-4 text-sm space-y-2">
            <h2 className="font-semibold mb-1">{t("purchases.detail.info")}</h2>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">{t("purchases.cols.supplier")}</span>
              <PartnerDetailLink kind="supplier" partnerId={purchase.supplierId} name={purchase.supplierName} className="justify-end text-right font-medium" />
            </div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">{t("purchases.cols.warehouse")}</span><span className="text-right">{purchase.warehouseName}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">{t("orders.cols.date")}</span><span className="text-right">{formatDate(purchase.createdAt)}</span></div>
            {purchase.createdByName && <div className="flex justify-between gap-3"><span className="text-slate-500">{t("purchases.detail.receiver")}</span><span className="text-right">{purchase.createdByName}</span></div>}
            {purchase.invoiceNumber && <div className="flex justify-between gap-3"><span className="text-slate-500">{t("purchases.invoiceNumber")}</span><span className="text-right">{purchase.invoiceNumber}</span></div>}
          </div>

          <div className="bg-surface border border-border rounded-card p-4 text-sm space-y-2">
            <h2 className="font-semibold mb-1">{t("purchases.detail.payment")}</h2>
            <div className="flex justify-between"><span className="text-slate-500">{t("purchases.subtotal")}</span><span className="tabular-nums">{formatCurrency(Number(purchase.subtotal))}</span></div>
            {Number(purchase.discount) > 0 && (
              <div className="flex justify-between"><span className="text-slate-500">{t("pos.discount")}</span><span className="tabular-nums text-ok">- {formatCurrency(Number(purchase.discount))}</span></div>
            )}
            {Number(purchase.tax) > 0 && (
              <div className="flex justify-between"><span className="text-slate-500">VAT {formatNumber(Number(purchase.vatRate))}%</span><span className="tabular-nums">{formatCurrency(Number(purchase.tax))}</span></div>
            )}
            {Number(purchase.shippingFee) > 0 && (
              <div className="flex justify-between"><span className="text-slate-500">Phí vận chuyển</span><span className="tabular-nums">{formatCurrency(Number(purchase.shippingFee))}</span></div>
            )}
            <div className="flex justify-between pt-1 text-base font-semibold">
              <span>{t("orders.cols.total")}</span>
              <span className="tabular-nums text-primary-600">{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between"><span className="text-slate-500">{t("purchases.amountPaid")}</span><span className="tabular-nums">{formatCurrency(paid)}</span></div>
            <div className="flex justify-between">
              <span className="text-slate-500">{t("purchases.cols.owed")}</span>
              <span className={cn("tabular-nums font-semibold", owed > 0 ? "text-warn" : "text-ok")}>{formatCurrency(owed)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
