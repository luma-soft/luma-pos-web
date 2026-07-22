import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getProducts, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { PricingTable } from "../../pricing/pricing-table";
import { TableSkeleton } from "@/components/table-skeleton";
import { Select } from "@/components/ui/select";

type SP = Record<string, string | undefined>;
type PriceBook = Awaited<ReturnType<typeof getPriceBooks>>[number];

export async function PricingTab({ searchParams }: { searchParams: SP }) {
  const [books, { categories }] = await Promise.all([
    getPriceBooks(),
    getProductFormOptions(),
  ]);

  return (
    <>
      <Suspense fallback={<TableSkeleton cols={4} rows={10} />}>
        <PricingContent books={books} categories={categories} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PricingContent({
  books,
  categories,
  searchParams,
}: {
  books: PriceBook[];
  categories: Awaited<ReturnType<typeof getProductFormOptions>>["categories"];
  searchParams: SP;
}) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const { rows, total, pageCount } = await getProducts({ q: params.q, categoryId: params.category, page, pageSize });

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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="shrink-0 text-sm font-bold">{t("pricing.booksCount", { n: books.length })}</h2>
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-3" action={Routes.Inventory}>
          <input type="hidden" name="tab" value="pricing" />
          <div className="relative min-w-[240px] flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
          </div>
          <Select
            name="category"
            defaultValue={params.category ?? ""}
            options={[{ value: "", label: t("products.list.allCategories") }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            className="min-w-44"
          />
          <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full border border-border bg-surface hover:bg-surface-2">{t("common.search")}</button>
        </form>
      </div>
      <PricingTable books={books} rows={tableRows} total={total} />
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
    </>
  );
}
