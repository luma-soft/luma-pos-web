import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { getPurchase } from "@/lib/data/inventory";
import { getPrintTemplate, getPrintTemplatesForDoc, type PaperSize } from "@/lib/print/template";
import { PrintDoc } from "@/components/print/print-doc";
import { PrintToolbar } from "@/components/print/print-toolbar";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string; templateId?: string }>;
}

export default async function PrintPurchasePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { size: sizeParam, templateId } = await searchParams;
  const t = await getTranslations();
  const [po, template] = await Promise.all([
    getPurchase(id).catch(() => null),
    getPrintTemplate("purchase", templateId),
  ]);
  const templates = await getPrintTemplatesForDoc("purchase");
  if (!po) notFound();

  const size: PaperSize = (["a4", "a5", "k80"] as const).includes(sizeParam as PaperSize)
    ? (sizeParam as PaperSize)
    : template.paperDefault;

  const total = Number(po.total);
  const paid = Number(po.amountPaid);
  const owed = Math.max(0, total - paid);

  return (
    <div className="min-h-screen bg-slate-200 dark:bg-slate-950 print:bg-white">
      <PrintToolbar backHref={Routes.purchase(po.id)} baseHref={`${Routes.purchase(po.id)}/print`} size={size} templates={templates} selectedTemplateId={template.id} />
      <div className="py-8 print:py-0 flex justify-center">
        <PrintDoc
          template={template}
          size={size}
          title={po.status === "received" ? t("print.titles.purchase") : t("print.titles.purchaseDraft")}
          code={po.code}
          date={po.createdAt}
          partyLabel={t("purchases.cols.supplier")}
          partyName={po.supplierName}
          partyPhone={po.supplierPhone}
          deliveryAddress={po.warehouseName}
          deliverToLabel={t("purchases.cols.warehouse")}
          sellerLabel={t("print.sellerSign")}
          sellerName={po.createdByName}
          items={po.items.map((i) => ({
            id: i.id,
            name: i.productName,
            sku: i.sku,
            unitName: i.baseUnit,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitCost),
            discount: Number(i.discount),
            total: Number(i.total),
          }))}
          totals={[
            { label: t("purchases.subtotal"), value: Number(po.subtotal), kind: "subtotal" },
            ...(Number(po.discount) > 0 ? [{ label: t("pos.discount"), value: Number(po.discount), negative: true, kind: "discount" as const }] : []),
            ...(Number(po.tax) > 0 ? [{ label: t("pos.tax"), value: Number(po.tax), kind: "tax" as const }] : []),
          ]}
          grandTotalLabel={t("print.grandTotal")}
          grandTotal={total}
          afterTotals={[
            ...(template.options.showDebt ? [{ label: t("purchases.amountPaid"), value: paid }] : []),
            ...(template.options.showDebt && owed > 0 ? [{ label: t("purchases.cols.owed"), value: owed, bold: true }] : []),
          ]}
          inWordsLabel={t("print.inWords")}
          signatures={[t("print.supplierSign"), t("print.receiverSign"), t("print.sellerSign")]}
          signHint={t("print.signHint")}
          note={po.note}
          cols={{
            product: t("orders.cols.product"),
            unit: t("orders.cols.unit"),
            qty: t("purchases.cols.qty"),
            unitPrice: t("purchases.cols.unitCost"),
            discount: t("orders.cols.discount"),
            lineTotal: t("orders.cols.lineTotal"),
          }}
        />
      </div>
    </div>
  );
}
