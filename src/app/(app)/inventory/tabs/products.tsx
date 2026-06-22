import { Fragment, Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Search, PackageOpen } from "lucide-react";
import { Routes } from "@/lib/routes";
import { formatCurrency, cn } from "@/lib/utils";
import { getProducts, getProductFormOptions } from "@/lib/data/products";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { TableSkeleton } from "@/components/table-skeleton";

type SP = Record<string, string | undefined>;
const STATUSES = ["active", "inactive", "all"] as const;
type Status = (typeof STATUSES)[number];
const VIEWS = ["grouped", "flat"] as const;
type View = (typeof VIEWS)[number];

export async function ProductsTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const status: Status = STATUSES.includes(params.status as Status) ? (params.status as Status) : "active";
  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "grouped";
  const { categories } = await getProductFormOptions();

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <Link href={Routes.Categories} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border text-sm font-medium hover:bg-surface-2">{t("categories.title")}</Link>
          <Link href={Routes.ProductNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98]"><Plus className="w-4 h-4" />{t("products.createNew")}</Link>
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-3 mb-4" action={Routes.Inventory}>
        <input type="hidden" name="tab" value="products" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <select name="category" defaultValue={params.category ?? ""} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          <option value="">{t("products.list.allCategories")}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="status" defaultValue={status} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          <option value="active">{t("products.list.statusActive")}</option>
          <option value="inactive">{t("products.list.statusInactive")}</option>
          <option value="all">{t("products.list.statusAll")}</option>
        </select>
        <select name="view" defaultValue={view} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          <option value="grouped">Xem theo nhóm</option>
          <option value="flat">Xem từng SKU</option>
        </select>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full border border-border bg-surface hover:bg-surface-2">{t("common.search")}</button>
      </form>

      <Suspense fallback={<TableSkeleton cols={7} rows={10} />}>
        <ProductsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ProductsContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const status: Status = STATUSES.includes(params.status as Status) ? (params.status as Status) : "active";
  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "grouped";

  const { rows, total, pageCount } = await getProducts({ q: params.q, categoryId: params.category, status, view, page, pageSize });

  const priceLabel = (p: (typeof rows)[number]) => {
    const min = Number(p.minRetailPrice ?? p.retailPrice);
    const max = Number(p.maxRetailPrice ?? p.retailPrice);
    return min !== max ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(max);
  };

  return (
    <>
      <div className="mb-2">
        <span className="text-sm text-slate-500">{t("products.list.total", { total })}</span>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <PackageOpen className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("products.list.empty")}</p>
          <p className="text-sm mt-1">{t("products.list.emptyHint")}</p>
        </div>
      ) : (
        <>
          <div className="lg:hidden space-y-2">
            {rows.map((p) => {
              const stock = Number(p.totalStock); const min = Number(p.minLevel); const lowStock = min > 0 && stock <= min;
              return (
                <div key={p.id} className="block bg-surface border border-border rounded-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={Routes.product(p.id)} className="min-w-0 hover:text-primary-600"><div className="font-medium truncate">{p.name}</div><div className="text-xs text-slate-400">{p.sku}{p.categoryName ? ` · ${p.categoryName}` : ""}</div></Link>
                    <span className={cn("shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", p.isVariantParent ? "bg-primary-50 text-primary-700" : p.isActive ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}>{p.isVariantParent ? `${p.childCount} SKU` : p.isActive ? t("products.list.active") : t("products.list.inactive")}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-sm">
                    <span className="font-semibold text-primary-600 tabular-nums">{priceLabel(p)}</span>
                    <span className={cn("tabular-nums", lowStock ? "text-er font-semibold" : "text-slate-500")}>{t("products.list.colStock")}: {stock.toLocaleString("vi-VN")} {p.baseUnit}</span>
                  </div>
                  {p.children.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-primary-600">Xem {p.children.length} SKU con</summary>
                      <div className="mt-2 divide-y divide-border-soft rounded-lg border border-border-soft">
                        {p.children.map((child) => (
                          <Link key={child.id} href={Routes.product(child.id)} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{child.variantName ?? child.name}</span>
                              <span className="block text-xs text-slate-400">{child.sku}</span>
                            </span>
                            <span className="shrink-0 text-right text-primary-600">{formatCurrency(Number(child.retailPrice))}</span>
                          </Link>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
            <table className="w-full min-w-170 text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">{t("products.list.colProduct")}</th>
                  <th className="px-4 py-3 font-semibold">{t("products.list.colCategory")}</th>
                  <th className="px-4 py-3 font-semibold">{t("products.list.colUnits")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("products.list.colRetail")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("products.list.colContractor")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("products.list.colStock")}</th>
                  <th className="px-4 py-3 font-semibold">{t("products.list.colStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.map((p) => {
                  const stock = Number(p.totalStock); const min = Number(p.minLevel); const lowStock = min > 0 && stock <= min;
                  return (
                    <Fragment key={p.id}>
                      <tr className="hover:bg-surface-2">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2">
                            <Link href={Routes.product(p.id)} className="font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600 hover:underline">{p.name}</Link>
                            {p.isVariantParent && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">{p.childCount} SKU</span>}
                          </div>
                          <div className="text-xs text-slate-400">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{p.categoryName ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{p.baseUnit}{p.unitNames ? ` · ${p.unitNames}` : ""}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{priceLabel(p)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{p.contractorPrice ? formatCurrency(Number(p.contractorPrice)) : "—"}</td>
                        <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", lowStock ? "text-er" : "text-slate-700 dark:text-slate-300")}>{stock.toLocaleString("vi-VN")} {p.baseUnit}</td>
                        <td className="px-4 py-3"><span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", p.isVariantParent ? "bg-primary-50 text-primary-700" : p.isActive ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}>{p.isVariantParent ? "Nhóm" : p.isActive ? t("products.list.active") : t("products.list.inactive")}</span></td>
                      </tr>
                      {p.children.length > 0 && p.children.map((child) => {
                        const childStock = Number(child.totalStock);
                        return (
                          <tr key={child.id} className="bg-slate-50/60 hover:bg-surface-2 dark:bg-slate-900/40">
                            <td className="px-4 py-2 pl-8">
                              <Link href={Routes.product(child.id)} className="font-medium text-slate-700 hover:text-primary-600 hover:underline dark:text-slate-200">{child.variantName ?? child.name}</Link>
                              <div className="text-xs text-slate-400">{child.sku}{child.barcode ? ` · ${child.barcode}` : ""}</div>
                            </td>
                            <td className="px-4 py-2 text-slate-500">{child.categoryName ?? "—"}</td>
                            <td className="px-4 py-2 text-slate-500">{child.baseUnit}{child.unitNames ? ` · ${child.unitNames}` : ""}</td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCurrency(Number(child.retailPrice))}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-500">{child.contractorPrice ? formatCurrency(Number(child.contractorPrice)) : "—"}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-600">{childStock.toLocaleString("vi-VN")} {child.baseUnit}</td>
                            <td className="px-4 py-2"><span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", child.isActive ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}>{child.isActive ? t("products.list.active") : t("products.list.inactive")}</span></td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
    </>
  );
}
