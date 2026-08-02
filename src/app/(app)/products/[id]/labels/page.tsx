import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import bwipjs from "bwip-js/node";
import type { ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { getProduct } from "@/lib/data/products";
import { getLabelTemplate, getLabelTemplates } from "@/lib/labels/template";
import type { LabelTemplate } from "@/lib/labels/template-shared";
import { Routes } from "@/lib/routes";
import { formatCurrency } from "@/lib/utils";
import { LabelPrintButton } from "./label-print-button";
import { getStoreSettings } from "@/lib/data/settings";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { InstantFilterForm } from "@/components/instant-filter-form";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

type CodeSource = "barcode" | "sku";
type LabelProduct = {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  retailPrice: string;
  baseUnit: string;
  quantity: number;
};

function clampQty(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 1), 500) : 12;
}

function pickCode(product: LabelProduct, source: CodeSource) {
  if (source === "barcode") return product.barcode || product.sku;
  return product.sku || product.barcode || "";
}

function selectedProductIds(primaryId: string, idsParam?: string) {
  const ids = [primaryId, ...(idsParam?.split(",") ?? [])].filter(Boolean);
  return [...new Set(ids)].slice(0, 100);
}

function quantityForProduct(query: Record<string, string | undefined>, productId: string) {
  return clampQty(query[`qty_${productId}`] ?? "1");
}

function barcodeSvg(value: string, template: LabelTemplate) {
  try {
    return bwipjs.toSVG({
      bcid: template.barcodeType,
      text: value || "LUMAPOS",
      scale: 2,
      height: Math.max(6, Math.min(40, Math.round(template.barcodeHeightMm))),
      includetext: false,
      paddingwidth: Math.max(0, Math.round(template.barcodeQuietMm * 2)),
      paddingheight: 0,
    });
  } catch {
    return bwipjs.toSVG({ bcid: "code128", text: "LUMAPOS", scale: 2, height: 10, includetext: false });
  }
}

export default async function ProductLabelsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [t, templates, store] = await Promise.all([getTranslations(), getLabelTemplates(), getStoreSettings()]);
  const products = (await Promise.all(selectedProductIds(id, query.ids).map((productId) => getProduct(productId)))).filter(
    (candidate): candidate is NonNullable<Awaited<ReturnType<typeof getProduct>>> => Boolean(candidate),
  );
  const product = products[0];
  if (!product) notFound();

  const template = await getLabelTemplate(query.templateId);
  const qty = clampQty(query.qty);
  const codeSource: CodeSource = query.codeSource === "sku" ? "sku" : "barcode";
  const isBatch = products.length > 1;
  const hasPriceOverride = query.price !== undefined && query.price !== "" && Number.isFinite(Number(query.price));
  const labelProducts: LabelProduct[] = products.flatMap((selectedProduct) => {
    const selectedQuantity = isBatch ? quantityForProduct(query, selectedProduct.id) : qty;
    return selectedProduct.isVariantParent && selectedProduct.children.length > 0
    ? selectedProduct.children.map((child) => ({
        id: child.id,
        name: child.name,
        sku: child.sku,
        barcode: child.barcode,
        retailPrice: child.retailPrice,
        baseUnit: child.baseUnit,
        quantity: selectedQuantity,
      }))
    : [{
        id: selectedProduct.id,
        name: selectedProduct.name,
        sku: selectedProduct.sku,
        barcode: selectedProduct.barcode,
        retailPrice: selectedProduct.retailPrice,
        baseUnit: selectedProduct.baseUnit,
        quantity: selectedQuantity,
      }];
  });
  const labels = labelProducts.flatMap((item) => Array.from({ length: item.quantity }, () => {
    const code = pickCode(item, codeSource);
    return {
      product: item,
      code,
      price: formatCurrency(hasPriceOverride ? Number(query.price) : Number(item.retailPrice)),
      svg: barcodeSvg(code, template),
    };
  }));

  return (
    <div className="label-print-root fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6 print:static print:block print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { margin: 6mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <section role="dialog" aria-modal="true" aria-labelledby="label-print-title" className="flex h-full w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:h-[min(900px,calc(100dvh-48px))] sm:max-w-6xl sm:rounded-card print:h-auto print:max-w-none print:overflow-visible print:border-0 print:shadow-none">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-5 print:hidden">
          <div className="min-w-0">
            <h1 id="label-print-title" className="truncate text-lg font-bold">{t("products.labels.title")}</h1>
            <p className="mt-0.5 truncate text-sm text-slate-500">{isBatch ? `${products.length} sản phẩm đã chọn` : product.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <LabelPrintButton label={t("products.labels.print")} />
            <Link href={query.from === "inventory" ? `${Routes.Inventory}?tab=products` : Routes.product(product.id)} className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-700 lg:h-9 lg:w-9" aria-label={t("common.close")}><X className="h-5 w-5" /></Link>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5 print:overflow-visible print:p-0">

        <InstantFilterForm className="mb-4 grid gap-3 rounded-card border border-border bg-surface p-4 print:hidden sm:grid-cols-[minmax(0,1fr)_150px_150px]">
          {query.ids && <input type="hidden" name="ids" value={query.ids} />}
          {query.from && <input type="hidden" name="from" value={query.from} />}
          <Field label={t("products.labels.template")}><Select name="templateId" defaultValue={template.id} options={templates.map((item) => ({ value: item.id, label: item.name }))} rootClassName="w-full" searchable /></Field>
          {!isBatch && <Field label={t("products.labels.quantity")}>
            <NumberInput name="qty" min={1} max={500} defaultValue={qty} thousandSeparator={false} className="h-11 bg-canvas lg:h-10" />
          </Field>}
          <Field label={t("products.labels.codeSource")}><Select name="codeSource" defaultValue={codeSource} options={[{ value: "barcode", label: t("products.labels.codeSourceBarcode") }, { value: "sku", label: t("products.labels.codeSourceSku") }]} rootClassName="w-full" /></Field>
          <Field label={t("products.labels.price")}>
            <NumberInput name="price" min={0} step={1000} defaultValue={hasPriceOverride ? Number(query.price) : isBatch ? undefined : Number(product.retailPrice)} placeholder={isBatch ? "Giá riêng theo sản phẩm" : undefined} suffix="đ" className="h-11 bg-canvas lg:h-10" />
          </Field>
          {isBatch && (
            <div className="overflow-hidden rounded-lg border border-border-soft sm:col-span-3">
              <div className="border-b border-border-soft px-3 py-2 text-sm font-semibold">Số lượng từng sản phẩm</div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="sticky top-0 bg-canvas text-left text-xs font-semibold text-slate-500">
                    <tr><th className="px-3 py-2">Mã hàng</th><th className="px-3 py-2">Tên hàng</th><th className="w-32 px-3 py-2 text-right">{t("products.labels.quantity")}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {products.map((selectedProduct) => (
                      <tr key={selectedProduct.id}>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{selectedProduct.sku}</td>
                        <td className="px-3 py-2 font-medium">{selectedProduct.name}</td>
                        <td className="px-3 py-2"><NumberInput name={`qty_${selectedProduct.id}`} min={1} max={500} defaultValue={quantityForProduct(query, selectedProduct.id)} thousandSeparator={false} className="h-10 w-24 bg-canvas" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </InstantFilterForm>

        <section className="rounded-card border border-border bg-surface p-4 print:border-0 print:bg-white print:p-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
            <h2 className="text-sm font-semibold text-slate-500">{t("products.labels.preview")}</h2>
            <p className="text-xs text-slate-500">
              {template.name} · {template.widthMm}x{template.heightMm}mm · {labels.length} {t("products.labels.labelsUnit")}
            </p>
          </div>
          <div
            className="grid justify-center"
            style={{
              gridTemplateColumns: `repeat(${template.columns}, ${template.widthMm}mm)`,
              gap: `${template.gapMm}mm`,
            }}
          >
            {labels.map((label, index) => (
              <ProductLabel
                key={`${label.product.id}-${index}`}
                template={template}
                name={label.product.name}
                sku={label.product.sku}
                unitName={label.product.baseUnit}
                code={label.code}
                price={label.price}
                codeLabel={t("products.labels.barcodeValue")}
                priceLabel={t("products.labels.price")}
                storeName={store.name}
                barcodeSvg={label.svg}
              />
            ))}
          </div>
        </section>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function ProductLabel({
  template,
  name,
  sku,
  unitName,
  code,
  price,
  codeLabel,
  priceLabel,
  storeName,
  barcodeSvg,
}: {
  template: LabelTemplate;
  name: string;
  sku: string;
  unitName: string;
  code: string;
  price: string;
  codeLabel: string;
  priceLabel: string;
  storeName: string;
  barcodeSvg: string;
}) {
  const nameSize = 10 * template.fontScale;
  const metaSize = 8 * template.fontScale;
  const codeSize = 7 * template.fontScale;
  return (
    <div
      className="break-inside-avoid overflow-hidden border border-slate-300 bg-white p-[2mm] text-slate-950 shadow-sm print:shadow-none"
      style={{ width: `${template.widthMm}mm`, height: `${template.heightMm}mm` }}
    >
      {template.showStoreName && <div className="truncate text-center font-bold uppercase tracking-wide text-slate-500" style={{ fontSize: `${6.5 * template.fontScale}px` }}>{storeName || "LumaPOS"}</div>}
      {template.showName && <div className="line-clamp-2 font-bold leading-tight" style={{ fontSize: `${nameSize}px` }}>{name}</div>}
      <div className="mt-[1mm] flex items-center justify-between gap-1" style={{ fontSize: `${metaSize}px` }}>
        {template.showSku && <span className="truncate font-mono text-slate-500">{sku}</span>}
        {template.showUnit && <span className="shrink-0 text-slate-500">{unitName}</span>}
        {template.showPrice && <span className="shrink-0 font-semibold">{priceLabel}: {price}</span>}
      </div>
      <div className="mt-[1mm] flex items-center justify-center overflow-hidden" style={{ height: `${template.barcodeHeightMm}mm`, paddingInline: `${template.barcodeQuietMm}mm` }} dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
      {template.showBarcodeText && (
        <div className="mt-[1mm] flex items-center justify-between gap-1 font-medium text-slate-600" style={{ fontSize: `${codeSize}px` }}>
          <span>{codeLabel}</span>
          <span className="truncate font-mono text-slate-950">{code}</span>
        </div>
      )}
    </div>
  );
}
