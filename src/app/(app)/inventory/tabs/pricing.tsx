import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getProducts, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { PricingTable } from "../../pricing/pricing-table";

type SP = Record<string, string | undefined>;

export async function PricingTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const [{ rows, total, pageCount }, books, { categories }] = await Promise.all([
    getProducts({ q: params.q, categoryId: params.category, page, pageSize }),
    getPriceBooks(),
    getProductFormOptions(),
  ]);

  const visibleIds = rows.map((p) => p.id);
  const overrideByBook = await getPriceOverridesForProducts(visibleIds);
  const tableRows = rows.map((p) => ({
    id: p.id, sku: p.sku, name: p.name, baseUnit: p.baseUnit,
    costPrice: Number(p.costPrice),
    lastPurchase: p.lastPurchasePrice != null ? Number(p.lastPurchasePrice) : Number(p.costPrice),
    prices: Object.fromEntries(books.map((b) => {
      if (b.isDefault) return [b.id, Number(p.retailPrice)];
      const ov = overrideByBook[b.id]?.[p.id];
      return [b.id, ov != null ? Number(ov) : null];
    })) as Record<string, number | null>,
  }));

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h2 className="text-sm font-bold">{t("pricing.booksCount", { n: books.length })}</h2>
        <span className="text-sm text-slate-500">{t("products.list.total", { total })}</span>
      </div>

      <form className="flex flex-wrap items-center gap-3 mb-4" action={Routes.Inventory}>
        <input type="hidden" name="tab" value="pricing" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <select name="category" defaultValue={params.category ?? ""} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          <option value="">{t("products.list.allCategories")}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full border border-border bg-surface hover:bg-surface-2">{t("common.search")}</button>
      </form>

      <PricingTable books={books} rows={tableRows} total={total} />
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
    </>
  );
}
