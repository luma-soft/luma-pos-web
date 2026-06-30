import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { getOrder } from "@/lib/data/orders";
import { getDefaultSepayBankAccount } from "@/lib/data/payment-bank-accounts";
import { getPrintTemplate, getPrintTemplatesForDoc, type PaperSize } from "@/lib/print/template";
import { buildSepayVietQrImageUrl } from "@/lib/payments/sepay";
import { PrintDoc } from "@/components/print/print-doc";
import { PrintToolbar } from "@/components/print/print-toolbar";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string; templateId?: string }>;
}

export default async function PrintOrderPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { size: sizeParam, templateId } = await searchParams;
  const t = await getTranslations();
  const order = await getOrder(id).catch(() => null);
  if (!order) notFound();
  const isQuote = order.status === "quote";
  const isBooking = order.status === "confirmed";
  const docType = isQuote ? "quote" : isBooking ? "booking" : "order";
  const [template, templates, defaultBankAccount] = await Promise.all([
    getPrintTemplate(docType, templateId),
    getPrintTemplatesForDoc(docType),
    getDefaultSepayBankAccount(),
  ]);

  const size: PaperSize = (["a4", "a5", "k80"] as const).includes(sizeParam as PaperSize)
    ? (sizeParam as PaperSize)
    : template.paperDefault;

  const total = Number(order.total);
  const paid = Number(order.amountPaid);
  const remaining = Math.max(0, total - paid);

  const totals = [
    { label: t("pos.subtotal"), value: Number(order.subtotal) },
    ...(Number(order.discount) > 0 ? [{ label: t("pos.discount"), value: Number(order.discount), negative: true }] : []),
    ...(Number(order.shippingFee) > 0 ? [{ label: t("pos.shipping"), value: Number(order.shippingFee) }] : []),
  ];
  const afterTotals = isQuote || isBooking ? [] : [
    ...(template.options.showDebt ? [{ label: t("print.paid"), value: paid }] : []),
    ...(template.options.showDebt && remaining > 0 ? [{ label: t("print.remaining"), value: remaining, bold: true }] : []),
  ];
  const paymentQr = !isQuote && !isBooking && template.options.showPaymentQr && remaining > 0 && defaultBankAccount
    ? {
        title: t("pos.sepay.title"),
        qrImageUrl: buildSepayVietQrImageUrl({
          bankCode: defaultBankAccount.bankCode,
          accountNumber: defaultBankAccount.accountNumber,
          amount: remaining,
          reference: order.code,
        }),
        bankLabel: t("pos.sepay.bank"),
        accountLabel: t("pos.sepay.account"),
        nameLabel: t("pos.sepay.name"),
        referenceLabel: t("pos.sepay.reference"),
        bankName: defaultBankAccount.gateway ?? defaultBankAccount.bankCode,
        accountNumber: defaultBankAccount.accountNumber,
        accountName: defaultBankAccount.accountName,
        reference: order.code,
      }
    : null;

  return (
    <div className="min-h-screen bg-slate-200 dark:bg-slate-950 print:bg-white">
      <PrintToolbar backHref={Routes.salesOrder(order.id, order.status)} baseHref={`${Routes.order(order.id)}/print`} size={size} templates={templates} selectedTemplateId={template.id} />
      <div className="py-8 print:py-0 flex justify-center">
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
            unitPrice: Number(i.unitPrice),
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
            product: t("orders.cols.product"),
            unit: t("orders.cols.unit"),
            qty: t("orders.cols.qty"),
            unitPrice: t("orders.cols.unitPrice"),
            lineTotal: t("orders.cols.lineTotal"),
          }}
        />
      </div>
    </div>
  );
}
