import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { getOrder } from "@/lib/data/orders";
import { getDefaultSepayBankAccount } from "@/lib/data/payment-bank-accounts";
import { getPrintTemplate, getPrintTemplatesForDoc, type PaperSize } from "@/lib/print/template";
import { buildSepayVietQrImageUrl } from "@/lib/payments/sepay";
import { PrintDoc } from "@/components/print/print-doc";
import { PrintToolbar } from "@/components/print/print-toolbar";

interface Props {
  searchParams: Promise<{ ids?: string | string[]; size?: string; templateId?: string }>;
}

const MAX_BATCH = 20;

export default async function PrintBatchPage({ searchParams }: Props) {
  const params = await searchParams;
  const t = await getTranslations();

  const ids = (Array.isArray(params.ids) ? params.ids : params.ids ? [params.ids] : [])
    .filter(Boolean)
    .slice(0, MAX_BATCH);

  const [template, templates, defaultBankAccount] = await Promise.all([
    getPrintTemplate("order", params.templateId),
    getPrintTemplatesForDoc("order"),
    getDefaultSepayBankAccount(),
  ]);
  const size: PaperSize = (["a4", "a5", "k80"] as const).includes(params.size as PaperSize)
    ? (params.size as PaperSize)
    : template.paperDefault;

  const orders = (await Promise.all(ids.map((id) => getOrder(id).catch(() => null))))
    .filter((o): o is NonNullable<typeof o> => o !== null && o.status !== "cancelled");

  if (orders.length === 0) {
    return (
      <div className="min-h-screen grid place-items-center text-center p-8">
        <div>
          <p className="text-slate-500 mb-4">{t("orders.batchEmpty")}</p>
          <Link href={Routes.Orders} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium">
            ← {t("orders.title")}
          </Link>
        </div>
      </div>
    );
  }

  const baseHref = `/orders/print-batch?${ids.map((id) => `ids=${id}`).join("&")}`;

  return (
    <div className="min-h-screen bg-slate-200 dark:bg-slate-950 print:bg-white">
      <PrintToolbar backHref={Routes.Orders} baseHref={baseHref} size={size} templates={templates} selectedTemplateId={template.id} />
      <div className="px-4 py-2 text-xs text-slate-500 text-center print:hidden">
        {t("orders.batchCount", { count: orders.length })}
      </div>
      <div className="py-4 print:py-0 flex flex-col items-center gap-8 print:gap-0">
        {orders.map((order) => {
          const total = Number(order.total);
          const paid = Number(order.amountPaid);
          const remaining = Math.max(0, total - paid);
          const paymentQr = template.options.showPaymentQr && remaining > 0 && defaultBankAccount
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
            <div key={order.id} className="break-after-page">
              <PrintDoc
                template={template}
                size={size}
                title={t("print.titles.order")}
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
                  discount: Number(i.discount),
                  total: Number(i.total),
                }))}
                totals={[
                  { label: t("pos.subtotal"), value: Number(order.subtotal), kind: "subtotal" },
                  ...(Number(order.discount) > 0 ? [{ label: t("pos.discount"), value: Number(order.discount), negative: true, kind: "discount" as const }] : []),
                  ...(Number(order.tax) > 0 ? [{ label: t("pos.tax"), value: Number(order.tax), kind: "tax" as const }] : []),
                  ...(Number(order.shippingFee) > 0 ? [{ label: t("pos.shipping"), value: Number(order.shippingFee), kind: "shipping" as const }] : []),
                ]}
                grandTotalLabel={t("print.grandTotal")}
                grandTotal={total}
                paymentQr={paymentQr}
                afterTotals={[
                  ...(template.options.showDebt ? [{ label: t("print.paid"), value: paid }] : []),
                  ...(template.options.showDebt && remaining > 0 ? [{ label: t("print.remaining"), value: remaining, bold: true }] : []),
                ]}
                inWordsLabel={t("print.inWords")}
                signatures={[t("print.buyerSign"), t("print.delivererSign"), t("print.sellerSign")]}
                signHint={t("print.signHint")}
                note={order.note}
                cols={{
                  product: t("orders.cols.product"),
                  unit: t("orders.cols.unit"),
                  qty: t("orders.cols.qty"),
                  unitPrice: t("orders.cols.unitPrice"),
                  discount: t("orders.cols.discount"),
                  lineTotal: t("orders.cols.lineTotal"),
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
