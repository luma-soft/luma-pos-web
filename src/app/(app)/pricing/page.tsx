import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getProducts, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { PricingTable } from "./pricing-table";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string; page?: string; size?: string }>;
}

export default async function PricingPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const [{ rows, total, pageCount }, books, { categories }] = await Promise.all([
    getProducts({ q: params.q, categoryId: params.category, page, pageSize }),
    getPriceBooks(),
    getProductFormOptions(),
  ]);

  // override giá (giá lẻ = retailPrice đọc trực tiếp) — 1 query cho mọi bảng × 20 SP đang hiển thị.
  const visibleIds = rows.map((p) => p.id);
  const overrideByBook = await getPriceOverridesForProducts(visibleIds);

  const tableRows = rows.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    baseUnit: p.baseUnit,
    costPrice: Number(p.costPrice),
    lastPurchase: p.lastPurchasePrice != null ? Number(p.lastPurchasePrice) : Number(p.costPrice),
    prices: Object.fromEntries(
      books.map((b) => {
        if (b.isDefault) return [b.id, Number(p.retailPrice)];
        const ov = overrideByBook[b.id]?.[p.id];
        return [b.id, ov != null ? Number(ov) : null];
      })
    ) as Record<string, number | null>,
  }));


  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-[17px] font-bold">{t("pricing.booksCount", { n: books.length })}</h1>
        <span className="text-sm text-slate-500">{t("products.list.total", { total })}</span>
      </div>

      <form className="flex flex-wrap items-center gap-3 mb-4" action={Routes.Pricing}>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text" name="q" defaultValue={params.q ?? ""}
            placeholder={t("products.list.searchPlaceholder")}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface"
          />
        </div>
        <select
          name="category" defaultValue={params.category ?? ""}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-surface"
        >
          <option value="">{t("products.list.allCategories")}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg border border-border bg-surface">
          {t("common.search")}
        </button>
      </form>

      <PricingTable books={books} rows={tableRows} total={total} />

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
    </div>
  );
}
