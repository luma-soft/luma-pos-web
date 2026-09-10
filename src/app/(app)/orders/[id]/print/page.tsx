import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { getOrder } from "@/lib/data/orders";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { getDefaultSepayBankAccount } from "@/lib/data/payment-bank-accounts";
import { getPrintTemplate, type PaperSize } from "@/lib/print/template";
import { buildPrintPaymentQr } from "@/lib/print/payment-qr";
import { PrintDoc } from "@/components/print/print-doc";
import { AutoPrint } from "@/components/print/auto-print";
import { requireStoreContext } from "@/lib/auth/store-context";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string; templateId?: string }>;
}

export default async function PrintOrderPage({ params, searchParams }: Props) {
  const { id } = await params;
  const context = await requireStoreContext();
  const { size: sizeParam, templateId } = await searchParams;
  const t = await getTranslations();
  const order = await getOrder(context.storeId, id).catch(() => null);
  if (!order) notFound();
  const isQuote = order.status === "quote";
  const isBooking = order.status === "confirmed";
  const docType = isQuote ? "quote" : isBooking ? "booking" : "order";
  const [template, defaultBankAccount] = await Promise.all([
    getPrintTemplate(context.storeId, docType, templateId),
    getDefaultSepayBankAccount(context.storeId),
  ]);

  const size: PaperSize = (["a4", "a5", "k80"] as const).includes(sizeParam as PaperSize)
    ? (sizeParam as PaperSize)
    : template.paperDefault;

  const total = Number(order.total);
  const paid = Number(order.amountPaid);
  const remaining = Math.max(0, total - paid);

  const totals = [
    { label: t("pos.subtotal"), value: Number(order.subtotal), kind: "subtotal" as const },
    ...(Number(order.discount) > 0 ? [{ label: t("pos.discount"), value: Number(order.discount), negative: true, kind: "discount" as const }] : []),
    ...(Number(order.tax) > 0 ? [{ label: t("pos.tax"), value: Number(order.tax), kind: "tax" as const }] : []),
    ...(Number(order.shippingFee) > 0 ? [{ label: t("pos.shipping"), value: Number(order.shippingFee), kind: "shipping" as const }] : []),
  ];
  const afterTotals = isQuote || isBooking ? [] : [
    ...(template.options.showDebt ? [{ label: t("print.paid"), value: paid }] : []),
    ...(template.options.showDebt && remaining > 0 ? [{ label: t("print.remaining"), value: remaining, bold: true }] : []),
  ];
  const paymentQr = buildPrintPaymentQr({
    enabled: !isQuote && !isBooking && template.options.showPaymentQr,
    alwaysShow: template.options.alwaysShowPaymentQr,
    account: defaultBankAccount,
    amount: remaining > 0 ? remaining : undefined,
    reference: order.code,
    labels: {
      title: t("pos.sepay.title"),
      bank: t("pos.sepay.bank"),
      account: t("pos.sepay.account"),
      name: t("pos.sepay.name"),
      reference: t("pos.sepay.reference"),
    },
  });

  return (
    <>
      <AutoPrint closeHref={Routes.salesOrder(order.id, order.status)} />
      <div className="print-document-root flex min-h-screen items-start justify-center overflow-auto py-8 print:py-0">
        <PrintDoc
          template={template}
          size={size}
          title={isQuote ? t("print.titles.quote") : isBooking ? t("print.titles.booking") : t("print.titles.order")}
          code={order.code}
          date={order.createdAt}
          partyLabel={t("orders.cols.customer")}
          partyName={order.customerName ?? t("orders.walkIn")}
          partyPhone={order.customerPhone}
          projectName={order.projectName}
          deliveryAddress={order.deliveryAddress}
          deliverToLabel={t("print.deliverTo")}
          sellerLabel={t("orders.detail.seller")}
          sellerName={order.sellerName}
          items={order.items.map((i) => ({
            id: i.id,
            name: i.productName,
            unitName: i.unitName,
            quantity: Number(i.quantity),
            ...readOrderLinePricing(i),
            total: Number(i.total),
          }))}
          totals={totals}
          grandTotalLabel={t("print.grandTotal")}
          grandTotal={total}
          afterTotals={afterTotals}
          paymentQr={paymentQr}
          inWordsLabel={t("print.inWords")}
          signatures={[t("print.buyerSign"), t("print.delivererSign"), t("print.sellerSign")]}
          signHint={t("print.signHint")}
          note={order.note}
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
    </>
  );
}
