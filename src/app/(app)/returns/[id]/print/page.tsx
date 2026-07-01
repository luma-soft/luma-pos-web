import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { getReturn } from "@/lib/data/returns";
import { getPrintTemplate, getPrintTemplatesForDoc, type PaperSize } from "@/lib/print/template";
import { PrintDoc } from "@/components/print/print-doc";
import { PrintToolbar } from "@/components/print/print-toolbar";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string; templateId?: string }>;
}

export default async function PrintReturnPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { size: sizeParam, templateId } = await searchParams;
  const t = await getTranslations();
  const [ret, template] = await Promise.all([
    getReturn(id).catch(() => null),
    getPrintTemplate("return", templateId),
  ]);
  const templates = await getPrintTemplatesForDoc("return");
  if (!ret) notFound();

  const size: PaperSize = (["a4", "a5", "k80"] as const).includes(sizeParam as PaperSize)
    ? (sizeParam as PaperSize)
    : template.paperDefault;

  return (
    <div className="min-h-screen bg-slate-200 dark:bg-slate-950 print:bg-white">
      <PrintToolbar
        backHref={ret.orderId ? Routes.salesOrder(ret.orderId, "completed") : Routes.Sales}
        baseHref={`/returns/${ret.id}/print`}
        size={size}
        templates={templates}
        selectedTemplateId={template.id}
      />
      <div className="py-8 print:py-0 flex justify-center">
        <PrintDoc
          template={template}
          size={size}
          title={t("print.titles.return")}
          code={ret.orderCode ? `${ret.code} ← ${ret.orderCode}` : ret.code}
          date={ret.createdAt}
          partyLabel={t("orders.cols.customer")}
          partyName={ret.customerName ?? t("orders.walkIn")}
          partyPhone={ret.customerPhone}
          sellerLabel={t("print.sellerSign")}
          sellerName={ret.createdByName}
          items={ret.items.map((i) => ({
            id: i.id,
            name: i.productName,
            unitName: i.unitName,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            discount: 0,
            total: Number(i.total),
          }))}
          totals={[]}
          grandTotalLabel={t("returns.totalRefund")}
          grandTotal={Number(ret.totalRefund)}
          afterTotals={[]}
          inWordsLabel={t("print.inWords")}
          signatures={[t("print.buyerSign"), t("print.sellerSign"), t("print.receiverSign")]}
          signHint={t("print.signHint")}
          note={[
            ret.reason ? `${t("returns.reason")}: ${t(`returns.reasons.${ret.reason}` as never)}` : null,
            `${t("returns.refundVia")}: ${t(`returns.refundMethods.${ret.refundMethod}` as never)}`,
            ret.note,
          ].filter(Boolean).join(" · ")}
          cols={{
            product: t("orders.cols.product"),
            unit: t("orders.cols.unit"),
            qty: t("returns.cols.returnNow"),
            unitPrice: t("orders.cols.unitPrice"),
            discount: t("orders.cols.discount"),
            lineTotal: t("returns.cols.refund"),
          }}
        />
      </div>
    </div>
  );
}
