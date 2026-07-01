import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import bwipjs from "bwip-js/node";
import type { ReactNode } from "react";
import { getProduct } from "@/lib/data/products";
import { getLabelTemplate, getLabelTemplates } from "@/lib/labels/template";
import type { LabelTemplate } from "@/lib/labels/template-shared";
import { Routes } from "@/lib/routes";
import { formatCurrency } from "@/lib/utils";
import { LabelPrintButton } from "./label-print-button";
import { getStoreSettings } from "@/lib/data/settings";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ templateId?: string; qty?: string; codeSource?: string; price?: string }>;
}

type CodeSource = "barcode" | "sku";
type LabelProduct = {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  retailPrice: string;
  baseUnit: string;
};

function clampQty(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 1), 500) : 12;
}

function pickCode(product: LabelProduct, source: CodeSource) {
  if (source === "barcode") return product.barcode || product.sku;
  return product.sku || product.barcode || "";
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
  const [t, product, templates, store] = await Promise.all([getTranslations(), getProduct(id), getLabelTemplates(), getStoreSettings()]);
  if (!product) notFound();

  const template = await getLabelTemplate(query.templateId);
  const qty = clampQty(query.qty);
  const codeSource: CodeSource = query.codeSource === "sku" ? "sku" : "barcode";
  const labelProducts: LabelProduct[] = product.isVariantParent && product.children.length > 0
    ? product.children.map((child) => ({
        id: child.id,
        name: child.name,
        sku: child.sku,
        barcode: child.barcode,
        retailPrice: child.retailPrice,
        baseUnit: child.baseUnit,
      }))
    : [{
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        retailPrice: product.retailPrice,
        baseUnit: product.baseUnit,
      }];
  const labels = labelProducts.flatMap((item) => Array.from({ length: qty }, () => {
    const code = pickCode(item, codeSource);
    return {
      product: item,
      code,
      price: formatCurrency(Number(query.price || item.retailPrice)),
      svg: barcodeSvg(code, template),
    };
  }));

  return (
    <div className="min-h-dvh bg-canvas p-4 sm:p-6 print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { margin: 6mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <div className="mx-auto max-w-5xl print:max-w-none">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={Routes.product(product.id)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-surface hover:bg-surface-2" aria-label={t("common.back")}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">{t("products.labels.title")}</h1>
              <p className="truncate text-sm text-slate-500">{product.name}</p>
            </div>
          </div>
          <LabelPrintButton label={t("products.labels.print")} />
        </header>

        <form className="mb-4 grid gap-3 rounded-card border border-border bg-surface p-4 print:hidden sm:grid-cols-[minmax(0,1fr)_120px_150px_150px_auto]">
          <Field label={t("products.labels.template")}>
            <select name="templateId" defaultValue={template.id} className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-sm">
              {templates.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t("products.labels.quantity")}>
            <input name="qty" type="number" min={1} max={500} defaultValue={qty} className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-sm" />
          </Field>
          <Field label={t("products.labels.codeSource")}>
            <select name="codeSource" defaultValue={codeSource} className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-sm">
              <option value="barcode">{t("products.labels.codeSourceBarcode")}</option>
              <option value="sku">{t("products.labels.codeSourceSku")}</option>
            </select>
          </Field>
          <Field label={t("products.labels.price")}>
            <input name="price" type="number" min={0} step={1000} defaultValue={Number(query.price || product.retailPrice)} className="h-10 w-full rounded-lg border border-border bg-canvas px-3 text-sm" />
          </Field>
          <div className="flex items-end">
            <button type="submit" className="h-10 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700">
              {t("common.apply")}
            </button>
          </div>
        </form>

        <section className="rounded-card border border-border bg-surface p-4 print:border-0 print:bg-white print:p-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
            <h2 className="text-sm font-semibold text-slate-500">{t("products.labels.preview")}</h2>
            <p className="text-xs text-slate-500">
              {template.name} · {template.widthMm}x{template.heightMm}mm · {labels.length} {t("products.labels.labelsUnit")}
            </p>
          </div>
          <div
            className="grid justify-start"
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
