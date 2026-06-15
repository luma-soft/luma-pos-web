import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Pencil } from "lucide-react";
import { getProduct } from "@/lib/data/products";
import { Routes } from "@/lib/routes";
import { formatCurrency, cn } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProductDetailPage({ params }: Props) {
  const { id } = await params;
  const [product, t] = await Promise.all([getProduct(id), getTranslations()]);
  if (!product) notFound();

  const specs = (product.specs as Record<string, string[]> | null) ?? {};
  const specEntries = Object.entries(specs);

  const rowCls = "flex justify-between gap-4 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0 text-sm";
  const lbl = "text-slate-500 shrink-0";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={Routes.Products} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-[17px] font-bold truncate">{product.name}</h1>
            <p className="text-xs text-slate-400">
              {product.sku} · {t("products.list.colStock")}: {Number(product.totalStock).toLocaleString("vi-VN")} {product.baseUnit}
              {!product.isActive && <span className="ml-2 text-warn">· {t("products.list.statusInactive")}</span>}
            </p>
          </div>
        </div>
        <Link
          href={`${Routes.product(id)}/edit`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
        >
          <Pencil className="w-4 h-4" />
          {t("common.edit")}
        </Link>
      </header>

      <div className="max-w-4xl mx-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
        {product.imageUrls && product.imageUrls.length > 0 && (
          <div className="md:col-span-2 flex flex-wrap gap-3">
            {product.imageUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt={product.name} className="w-32 h-32 rounded-card object-cover border border-border" />
            ))}
          </div>
        )}
        <Card title={t("products.tabs.info")}>
          <div className={rowCls}><span className={lbl}>{t("products.fields.sku")}</span><span className="font-medium">{product.sku}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.fields.barcode")}</span><span>{product.barcode ?? "—"}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.fields.category")}</span><span>{product.categoryName ?? "—"}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.fields.brand")}</span><span>{product.brandName ?? "—"}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.fields.baseUnit")}</span><span>{product.baseUnit}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.physical.location")}</span><span>{product.location ?? "—"}</span></div>
        </Card>

        <Card title={t("products.sections.pricing")}>
          <div className={rowCls}><span className={lbl}>{t("products.pricing.costPrice")}</span><span className="tabular-nums">{formatCurrency(Number(product.costPrice))}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.pricing.retailPrice")}</span><span className="tabular-nums font-semibold">{formatCurrency(Number(product.retailPrice))}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.pricing.wholesalePrice")}</span><span className="tabular-nums">{product.wholesalePrice != null ? formatCurrency(Number(product.wholesalePrice)) : "—"}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.pricing.contractorPrice")}</span><span className="tabular-nums">{product.contractorPrice != null ? formatCurrency(Number(product.contractorPrice)) : "—"}</span></div>
          <div className={rowCls}><span className={lbl}>{t("products.pricing.agentPrice")}</span><span className="tabular-nums">{product.agentPrice != null ? formatCurrency(Number(product.agentPrice)) : "—"}</span></div>
        </Card>

        <Card title={t("products.fields.suppliers")}>
          {product.suppliers.length === 0 ? (
            <p className="text-sm text-slate-400">—</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {product.suppliers.map((s) => (
                <Link key={s.id} href={Routes.supplier(s.id)} className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm hover:underline",
                  s.isPrimary ? "bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300" : "bg-surface-2"
                )}>
                  {s.isPrimary && <span className="text-[10px] font-bold uppercase">{t("products.fields.primarySupplier")}</span>}
                  {s.name ?? "—"}
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title={t("products.sections.units")}>
          {product.units.length === 0 ? (
            <p className="text-sm text-slate-400">{product.baseUnit}</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <div className={rowCls}><span className={lbl}>{t("products.fields.baseUnit")}</span><span>{product.baseUnit}</span></div>
              {product.units.map((u) => (
                <div key={u.unitName} className={rowCls}>
                  <span>{u.unitName}</span>
                  <span className="text-slate-500">× {Number(u.multiplier)} {product.baseUnit}{u.priceOverride != null ? ` · ${formatCurrency(Number(u.priceOverride))}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {specEntries.length > 0 && (
          <Card title={t("products.sections.attributes")}>
            {specEntries.map(([k, v]) => (
              <div key={k} className={rowCls}><span className={lbl}>{k}</span><span>{Array.isArray(v) ? v.join(", ") : String(v)}</span></div>
            ))}
          </Card>
        )}

        {product.description && (
          <Card title={t("products.description.main")}>
            <p className="text-sm whitespace-pre-line text-slate-600 dark:text-slate-300">{product.description}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-card p-5 self-start">
      <h2 className="font-semibold text-sm mb-3">{title}</h2>
      {children}
    </section>
  );
}
