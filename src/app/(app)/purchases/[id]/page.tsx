import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Copy, FilePenLine, Printer, ReceiptText } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getPurchase } from "@/lib/data/inventory";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import { Text } from "@/components/ui/text";
import { PurchaseCancelButton } from "./purchase-actions";

function statusClass(status: string) {
  if (status === "cancelled") return "bg-er-soft text-er";
  if (status === "returned") return "bg-warn-soft text-warn";
  if (status === "draft") return "bg-warn-soft text-warn";
  return "bg-ok-soft text-ok";
}

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const purchase = await getPurchase(id).catch(() => null);
  if (!purchase) notFound();

  const total = Number(purchase.total);
  const paid = Number(purchase.amountPaid);
  const owed = purchase.status === "cancelled" ? 0 : Math.max(0, total - paid);
  const canChange = purchase.status === "received" || purchase.status === "draft";

  const printHref = `${Routes.purchase(purchase.id)}/print`;
  const copyHref = Routes.purchaseCopy(purchase.id);
  const editHref = Routes.purchaseEdit(purchase.id);

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 min-h-[58px] px-4 sm:px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3 flex-wrap">
        <Link href={Routes.Purchases} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("common.back")}>
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="min-w-0">
          <Text as="h1" weight="bold" className="text-[17px]" text={purchase.code} />
          <Text as="p" variant="muted" size="xs" text={formatDate(purchase.createdAt)} />
        </div>
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass(purchase.status))}>
          {t(`purchases.status.${purchase.status}` as never)}
        </span>
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0">
          <Link href={printHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 shrink-0")}>
            <Printer className="h-4 w-4" />
            {t("print.printBtn")}
          </Link>
          {canChange && (
            <>
              <Link href={copyHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 shrink-0")}>
                <Copy className="h-4 w-4" />
                {t("purchases.copy")}
              </Link>
              <Link href={editHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 shrink-0")}>
                <FilePenLine className="h-4 w-4" />
                {t("purchases.edit")}
              </Link>
              <PurchaseCancelButton purchaseId={purchase.id} />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div>
                <Text as="h2" weight="semibold" text={t("purchases.detail.items", { count: purchase.items.length })} />
                <Text as="p" variant="muted" size="xs" text={purchase.supplierName} />
              </div>
              <ReceiptText className="h-5 w-5 text-slate-400" />
            </div>
            <div className="overflow-x-auto">
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
            <div className="bg-surface border border-border rounded-card p-3 flex flex-wrap items-center gap-2">
              <PurchaseCancelButton purchaseId={purchase.id} />
              <Link href={copyHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
                <Copy className="h-4 w-4" />
                {t("purchases.copy")}
              </Link>
              <Link href={printHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
                <Printer className="h-4 w-4" />
                {t("print.printBtn")}
              </Link>
              <Link href={editHref} className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-9 ml-auto")}>
                <FilePenLine className="h-4 w-4" />
                {t("purchases.edit")}
              </Link>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-surface border border-border rounded-card p-4 text-sm space-y-2">
            <h2 className="font-semibold mb-1">{t("purchases.detail.info")}</h2>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">{t("purchases.cols.supplier")}</span>
              <Link href={Routes.supplier(purchase.supplierId)} className="font-medium text-primary-600 hover:underline text-right">
                {purchase.supplierName}
              </Link>
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
