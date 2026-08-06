import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getProducts, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { PricingTable } from "../../pricing/pricing-table";
import { TableSkeleton } from "@/components/table-skeleton";
import { InstantProductSearch } from "./instant-product-search";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";

type SP = Record<string, string | undefined>;
type PriceBook = Awaited<ReturnType<typeof getPriceBooks>>[number];

export async function PricingTab({ searchParams }: { searchParams: SP }) {
  const [books, options] = await Promise.all([
    getPriceBooks(),
    getProductFormOptions(),
  ]);

  return (
    <>
      <Suspense fallback={<TableSkeleton cols={4} rows={10} />}>
        <PricingContent books={books} categories={options.categories} brands={options.brands} suppliers={options.suppliers} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PricingContent({
  books,
  categories,
  brands,
  suppliers,
  searchParams,
}: {
  books: PriceBook[];
  categories: Awaited<ReturnType<typeof getProductFormOptions>>["categories"];
  brands: Awaited<ReturnType<typeof getProductFormOptions>>["brands"];
  suppliers: Awaited<ReturnType<typeof getProductFormOptions>>["suppliers"];
  searchParams: SP;
}) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const { rows, total, pageCount } = await getProducts({ q: params.q, categoryId: params.category, brandId: params.brandId, supplierId: params.supplierId, productKind: params.productKind as "product" | "service" | "combo" | undefined, status: (params.status as "active" | "inactive" | "all" | undefined) ?? "active", page, pageSize });

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
        <InventoryFilterDrawer title="Bộ lọc thiết lập giá" values={params} resultCount={total} fields={["category", "brand", "supplier", "kind", "status", "stock", "sort"]} categories={categories.map((item) => ({ value: item.id, label: item.name }))} brands={brands.map((item) => ({ value: item.id, label: item.name }))} suppliers={suppliers.map((item) => ({ value: item.id, label: item.name }))} />
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
