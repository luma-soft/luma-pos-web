import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { AutoPrint } from "@/components/print/auto-print";
import { PrintDoc } from "@/components/print/print-doc";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getOrder } from "@/lib/data/orders";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { getPrintTemplate, type PaperSize } from "@/lib/print/template";
import { MergePrintToolbar } from "../merge-print-toolbar";

interface Props {
  searchParams: Promise<{
    ids?: string | string[];
    size?: string;
    templateId?: string;
    embedded?: string;
  }>;
}

export default async function MergePrintPreviewPage({ searchParams }: Props) {
  const [params, context, t] = await Promise.all([
    searchParams,
    requireStoreContext(),
    getTranslations(),
  ]);
  const ids = [...new Set((Array.isArray(params.ids) ? params.ids : params.ids ? [params.ids] : []).filter(Boolean))].slice(0, 20);
  if (ids.length < 2) notFound();

  const loadedOrders = await Promise.all(ids.map((id) => getOrder(context.storeId, id).catch(() => null)));
  if (loadedOrders.some((order) => order === null)) notFound();
  const sourceOrders = loadedOrders.filter((order): order is NonNullable<typeof order> => order !== null);
  const customerIds = new Set(sourceOrders.map((order) => order.customerId).filter((id): id is string => Boolean(id)));
  if (
    sourceOrders.length !== ids.length ||
    sourceOrders.some((order) => order.status !== "completed" || !order.customerId || order.returns.some((row) => row.status === "completed")) ||
    customerIds.size !== 1
  ) {
    notFound();
  }

  const [issuedEInvoice, template] = await Promise.all([
    db
      .select({ id: einvoices.id })
      .from(einvoices)
      .where(and(
        eq(einvoices.storeId, context.storeId),
        inArray(einvoices.orderId, ids),
        eq(einvoices.status, "issued"),
      ))
      .limit(1)
      .then((rows) => rows[0]),
    getPrintTemplate(context.storeId, "order", params.templateId),
  ]);
  if (issuedEInvoice) notFound();

  const size: PaperSize = (["a4", "a5", "k80"] as const).includes(params.size as PaperSize)
    ? params.size as PaperSize
    : template.paperDefault;
  const subtotal = sourceOrders.reduce((sum, order) => sum + Number(order.subtotal), 0);
  const discount = sourceOrders.reduce((sum, order) => sum + Number(order.discount), 0);
  const tax = sourceOrders.reduce((sum, order) => sum + Number(order.tax), 0);
  const shippingFee = sourceOrders.reduce((sum, order) => sum + Number(order.shippingFee), 0);
  const total = sourceOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const paid = sourceOrders.reduce((sum, order) => sum + Number(order.amountPaid), 0);
  const remaining = Math.max(0, total - paid);
  const primaryOrder = sourceOrders[0];
  const baseParams = new URLSearchParams();
  ids.forEach((id) => baseParams.append("ids", id));
  const backHref = `/orders/merge?${baseParams.toString()}`;
  const embedded = params.embedded === "1";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100 print:bg-white print:text-black">
      {embedded && <AutoPrint closeHref={backHref} printTitle={t("merge.previewCode")} />}
      <MergePrintToolbar
        backHref={backHref}
        backLabel={t("common.back")}
        title={t("merge.previewTitle")}
        notice={t("merge.previewNotice")}
        printLabel={t("merge.printSample")}
      />
      <div className="print-document-root flex min-h-[calc(100vh-72px)] items-start justify-center overflow-auto px-4 py-8 print:min-h-0 print:overflow-visible print:px-0 print:py-0">
        <PrintDoc
          template={template}
          size={size}
          title={t("print.titles.order")}
          code={t("merge.previewCode")}
          date={new Date()}
          partyLabel={t("orders.cols.customer")}
          partyName={primaryOrder.customerName ?? t("orders.walkIn")}
          partyPhone={primaryOrder.customerPhone}
          projectName={primaryOrder.projectName}
          deliveryAddress={primaryOrder.deliveryAddress}
          deliverToLabel={t("print.deliverTo")}
          sellerLabel={t("orders.detail.seller")}
          sellerName={primaryOrder.sellerName}
          items={sourceOrders.flatMap((order) => order.items.map((item) => ({
            id: `${order.id}-${item.id}`,
            name: item.productName,
            variantName: item.productVariantName,
            specs: item.productSpecs,
            unitName: item.unitName,
            quantity: Number(item.quantity),
            ...readOrderLinePricing(item),
            total: Number(item.total),
          })))}
          totals={[
            { label: t("pos.subtotal"), value: subtotal, kind: "subtotal" },
            ...(template.options.showDiscount ? [{ label: t("pos.discount"), value: discount, negative: true, kind: "discount" as const }] : []),
            ...(template.options.showTax ? [{ label: t("pos.tax"), value: tax, kind: "tax" as const }] : []),
            ...(shippingFee > 0 ? [{ label: t("pos.shipping"), value: shippingFee, kind: "shipping" as const }] : []),
          ]}
          grandTotalLabel={t("print.grandTotal")}
          grandTotal={total}
          afterTotals={[
            ...(template.options.showDebt ? [{ label: t("print.paid"), value: paid }] : []),
            ...(template.options.showDebt && remaining > 0 ? [{ label: t("print.remaining"), value: remaining, bold: true }] : []),
            ...(template.options.showCustomerDebtBalance && primaryOrder.customerId ? [
              { label: t("print.customerDebtBefore"), value: Number(primaryOrder.customerDebt ?? 0) - remaining },
              { label: t("print.customerDebtAfter"), value: Number(primaryOrder.customerDebt ?? 0), bold: true },
            ] : []),
          ]}
          paymentQr={null}
          inWordsLabel={t("print.inWords")}
          signatures={[t("print.buyerSign"), t("print.delivererSign"), t("print.sellerSign")]}
          signHint={t("print.signHint")}
          note={`Gộp từ: ${sourceOrders.map((order) => order.code).join(", ")}`}
          cols={{
            index: t("print.index"),
            product: t("orders.cols.product"),
            unit: t("orders.cols.unit"),
            qty: t("orders.cols.qty"),
            unitPrice: t("orders.cols.unitPrice"),
            discount: t("orders.cols.discount"),
            lineTotal: t("orders.cols.lineTotal"),
          }}
        />
      </div>
    </div>
  );
}
