import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getProducts, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { PricingTable } from "../../pricing/pricing-table";
import { TableSkeleton } from "@/components/table-skeleton";
import { InstantProductSearch } from "./instant-product-search";
import { InstantProductFilters } from "./instant-product-filters";

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
        <InstantProductSearch
          value={params.q ?? ""}
          placeholder={t("products.list.searchPlaceholder")}
        />
        <InstantProductFilters
          category={params.category ?? ""}
          status="active"
          view="grouped"
          categories={categories}
          labels={{
            filters: t("products.list.filters"),
            allCategories: t("products.list.allCategories"),
            searchCategories: t("products.list.searchCategories"),
            active: t("products.list.statusActive"),
            inactive: t("products.list.statusInactive"),
            all: t("products.list.statusAll"),
            grouped: t("products.list.viewGrouped"),
            flat: t("products.list.viewFlat"),
          }}
          showAdditionalFilters={false}
        />
      </div>
      <PricingTable
        key={[params.q ?? "", params.category ?? "", page, pageSize].join(":")}
        books={books}
        rows={tableRows}
        total={total}
      />
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
    </>
  );
}
