import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { getOrder } from "@/lib/data/orders";
import { readOrderLinePricing } from "@/lib/orders/line-pricing-snapshot";
import { getDefaultSepayBankAccount } from "@/lib/data/payment-bank-accounts";
import { getPrintTemplate, type PaperSize } from "@/lib/print/template";
import { buildSepayVietQrImageUrl } from "@/lib/payments/sepay";
import { PrintDoc } from "@/components/print/print-doc";
import { AutoPrint } from "@/components/print/auto-print";
import { requireStoreContext } from "@/lib/auth/store-context";

interface Props {
  searchParams: Promise<{ ids?: string | string[]; size?: string; templateId?: string }>;
}

export default async function PrintBatchPage({ searchParams }: Props) {
  const params = await searchParams;
  const context = await requireStoreContext();
  const t = await getTranslations();

  const ids = (Array.isArray(params.ids) ? params.ids : params.ids ? [params.ids] : [])
    .filter(Boolean);

  const [template, defaultBankAccount] = await Promise.all([
    getPrintTemplate(context.storeId, "order", params.templateId),
    getDefaultSepayBankAccount(),
  ]);
  const size: PaperSize = (["a4", "a5", "k80"] as const).includes(params.size as PaperSize)
    ? (params.size as PaperSize)
    : template.paperDefault;

  const orders = (await Promise.all(ids.map((id) => getOrder(context.storeId, id).catch(() => null))))
    .filter((o): o is NonNullable<typeof o> => o !== null && o.status !== "cancelled");

  if (orders.length === 0) {
    return (
      <div className="min-h-screen grid place-items-center text-center p-8">
        <div>
          <p className="text-slate-500 mb-4">{t("orders.batchEmpty")}</p>
          <Link href={Routes.Orders} className="inline-flex min-h-11 min-w-11 items-center justify-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium lg:min-h-0 lg:min-w-0">
            ← {t("orders.title")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <AutoPrint closeHref={Routes.Orders} />
      <div className="print-document-root flex min-h-screen flex-col items-center gap-8 overflow-auto py-4 print:gap-0 print:py-0">
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
                  ...readOrderLinePricing(i),
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
    </>
  );
}
