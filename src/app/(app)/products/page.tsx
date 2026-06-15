import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Search, PackageOpen } from "lucide-react";
import { Routes } from "@/lib/routes";
import { formatCurrency, cn } from "@/lib/utils";
import { getProducts, getProductFormOptions } from "@/lib/data/products";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string; status?: string; page?: string; size?: string }>;
}

const STATUSES = ["active", "inactive", "all"] as const;
type Status = (typeof STATUSES)[number];

export default async function ProductsPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const status: Status = STATUSES.includes(params.status as Status) ? (params.status as Status) : "active";

  const [{ rows, total, pageCount }, { categories }] = await Promise.all([
    getProducts({ q: params.q, categoryId: params.category, status, page, pageSize }),
    getProductFormOptions(),
  ]);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-bold">{t("products.title")}</h1>
          <span className="text-sm text-slate-500">{t("products.list.total", { total })}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={Routes.Categories}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface-2"
          >
            {t("categories.title")}
          </Link>
          <Link
            href={Routes.ProductNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            {t("products.createNew")}
          </Link>
        </div>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-center gap-3 mb-4" action={Routes.Products}>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder={t("products.list.searchPlaceholder")}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface"
          />
        </div>
        <select
          name="category"
          defaultValue={params.category ?? ""}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-surface"
        >
          <option value="">{t("products.list.allCategories")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-surface"
        >
          <option value="active">{t("products.list.statusActive")}</option>
          <option value="inactive">{t("products.list.statusInactive")}</option>
          <option value="all">{t("products.list.statusAll")}</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium rounded-lg border border-border bg-surface hover:bg-surface-2"
        >
          {t("common.search")}
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <PackageOpen className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("products.list.empty")}</p>
          <p className="text-sm mt-1">{t("products.list.emptyHint")}</p>
        </div>
      ) : (
        <>
        {/* mobile: danh sách dạng thẻ */}
        <div className="lg:hidden space-y-2">
          {rows.map((p) => {
            const stock = Number(p.totalStock);
            const min = Number(p.minLevel);
            const lowStock = min > 0 && stock <= min;
            return (
              <Link key={p.id} href={Routes.product(p.id)} className="block bg-surface border border-border rounded-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.sku}{p.categoryName ? ` · ${p.categoryName}` : ""}</div>
                  </div>
                  <span className={cn("shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                    p.isActive ? "bg-ok-soft text-ok" : "bg-surface-2 text-slate-500")}>
                    {p.isActive ? t("products.list.active") : t("products.list.inactive")}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2 text-sm">
                  <span className="font-semibold text-primary-600 tabular-nums">{formatCurrency(Number(p.retailPrice))}</span>
                  <span className={cn("tabular-nums", lowStock ? "text-er font-semibold" : "text-slate-500")}>{t("products.list.colStock")}: {stock.toLocaleString("vi-VN")} {p.baseUnit}</span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* desktop: bảng */}
        <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
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
                const stock = Number(p.totalStock);
                const min = Number(p.minLevel);
                const lowStock = min > 0 && stock <= min;
                return (
                  <tr key={p.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={Routes.product(p.id)} className="font-medium text-slate-900 dark:text-slate-100 hover:text-primary-600 hover:underline">
                        {p.name}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {p.sku}{p.barcode ? ` · ${p.barcode}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{p.categoryName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {p.baseUnit}{p.unitNames ? ` · ${p.unitNames}` : ""}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {formatCurrency(Number(p.retailPrice))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                      {p.contractorPrice ? formatCurrency(Number(p.contractorPrice)) : "—"}
                    </td>
                    <td className={cn(
                      "px-4 py-3 text-right tabular-nums font-semibold",
                      lowStock ? "text-er" : "text-slate-700 dark:text-slate-300"
                    )}>
                      {stock.toLocaleString("vi-VN")} {p.baseUnit}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        p.isActive
                          ? "bg-ok-soft text-ok"
                          : "bg-surface-2 text-slate-500"
                      )}>
                        {p.isActive ? t("products.list.active") : t("products.list.inactive")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
    </div>
  );
}
