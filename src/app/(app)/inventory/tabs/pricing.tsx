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
import { ListSearchFilterBar } from "@/components/list-search-filter";
import { requireStoreContext } from "@/lib/auth/store-context";
import { canViewPurchasePrices, isSystemPriceBook, resolvePriceBookPrice } from "@/lib/pricing/system-price-books";

type SP = Record<string, string | undefined>;
type PriceBook = Awaited<ReturnType<typeof getPriceBooks>>[number];

export async function PricingTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const includePurchasePrices = canViewPurchasePrices(context.role);
  const [books, options] = await Promise.all([
    getPriceBooks(context.storeId, { includeManagerOnly: includePurchasePrices }),
    getProductFormOptions(context.storeId),
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
  const context = await requireStoreContext();
  const includePurchasePrices = canViewPurchasePrices(context.role);
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const { rows, total, pageCount } = await getProducts(context.storeId, { q: params.q, categoryId: params.category, brandId: params.brandId, supplierId: params.supplierId, productKind: params.productKind as "product" | "service" | "combo" | undefined, stock: params.stock as "instock" | "low" | "out" | undefined, sort: params.sort as "name" | "stock" | "updated" | undefined, status: (params.status as "active" | "inactive" | "all" | undefined) ?? "active", page, pageSize });

  const visibleIds = rows.map((p) => p.id);
  const overrideByBook = await getPriceOverridesForProducts(context.storeId, visibleIds);
  const tableRows = rows.map((p) => ({
    id: p.id, sku: p.sku, name: p.name, baseUnit: p.baseUnit,
    costPrice: includePurchasePrices ? Number(p.costPrice) : null,
    lastPurchase: includePurchasePrices && p.lastPurchasePrice != null ? Number(p.lastPurchasePrice) : null,
    prices: Object.fromEntries(books.map((b) => {
      const ov = overrideByBook[b.id]?.[p.id];
      if (!isSystemPriceBook(b)) return [b.id, ov != null ? Number(ov) : null];
      return [b.id, resolvePriceBookPrice(b, {
        retailPrice: Number(p.retailPrice),
        costPrice: includePurchasePrices ? Number(p.costPrice) : null,
        lastPurchasePrice: includePurchasePrices && p.lastPurchasePrice != null ? Number(p.lastPurchasePrice) : null,
      })];
    })) as Record<string, number | null>,
  }));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="shrink-0 text-sm font-bold">{t("pricing.booksCount", { n: books.length })}</h2>
        <ListSearchFilterBar
          search={<InstantProductSearch value={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} />}
          filter={<InventoryFilterDrawer title="Bộ lọc thiết lập giá" values={params} resultCount={total} fields={["category", "brand", "supplier", "kind", "status", "stock", "sort"]} categories={categories.map((item) => ({ value: item.id, label: item.name }))} brands={brands.map((item) => ({ value: item.id, label: item.name }))} suppliers={suppliers.map((item) => ({ value: item.id, label: item.name }))} />}
        />
      </div>
      <PricingTable
        key={JSON.stringify([books, tableRows, params])}
        books={books}
        rows={tableRows}
        total={total}
        canViewPurchasePrices={includePurchasePrices}
        resetScrollKey={[
          params.q,
          params.category,
          params.brandId,
          params.supplierId,
          params.productKind,
          params.stock,
          params.sort,
          params.status,
          page,
          pageSize,
        ].join("\u0000")}
      />
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
    </>
  );
}
