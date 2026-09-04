import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getProductFormOptions } from "@/lib/data/products";
import { getPricingPage } from "@/lib/data/pricing";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { PricingTable } from "../../pricing/pricing-table";
import { TableSkeleton } from "@/components/table-skeleton";
import { InstantProductSearch } from "./instant-product-search";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";
import { ListSearchFilterBar } from "@/components/list-search-filter";
import { requireStoreContext } from "@/lib/auth/store-context";
import { canViewPurchasePrices, comparePriceBooks, isSystemPriceBook, resolvePriceBookPrice } from "@/lib/pricing/system-price-books";
import { priceFormulaFiltersSchema } from "@/lib/pricing/price-edit";
import type { PricingSort } from "@/lib/pricing/pricing-policy";

type SP = Record<string, string | undefined>;
type PriceBook = Awaited<ReturnType<typeof getPriceBooks>>[number];

/** Inventory URL aliases must become the same validated predicate for list and bulk. */
export function inventoryPricingFilters(params: SP) {
  const ids = (value?: string) => value ? value.split(",").map((id) => id.trim()).filter(Boolean) : undefined;
  const stock = params.stock ? ({ instock: "available", low: "lowStock", out: "outOfStock" }[params.stock] ?? params.stock) : undefined;
  const lifecycle = params.lifecycle || (params.status === "inactive" ? "paused" : params.status) || "active";
  return priceFormulaFiltersSchema.parse({
    q: params.q, categoryIds: ids(params.categoryIds ?? params.category),
    brandIds: ids(params.brandIds ?? params.brandId), supplierIds: ids(params.supplierIds ?? params.supplierId),
    productKind: params.productKind || undefined, stock, lifecycle, warehouseId: params.warehouseId || undefined,
  });
}

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
        <PricingContent books={[...books].sort(comparePriceBooks)} categories={options.categories} brands={options.brands} suppliers={options.suppliers} searchParams={searchParams} />
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

  const filters = inventoryPricingFilters(params);
  const { rows, total, pageCount } = await getPricingPage(context.storeId, { ...filters, sort: params.sort as PricingSort | undefined, page, pageSize });

  const visibleIds = rows.map((p) => p.id);
  const overrideByBook = await getPriceOverridesForProducts(context.storeId, visibleIds);
  const tableRows = rows.map((p) => ({
    id: p.id, sku: p.sku, name: p.name, baseUnit: p.baseUnit,
    units: (p.units ?? []).map((unit) => ({
      id: unit.id, unitName: unit.unitName, multiplier: Number(unit.multiplier),
      priceOverride: unit.priceOverride == null ? null : Number(unit.priceOverride),
    })),
    costPrice: includePurchasePrices ? Number(p.costPrice) : null,
    lastPurchase: includePurchasePrices && p.lastPurchaseNetPrice != null ? Number(p.lastPurchaseNetPrice) : null,
    prices: Object.fromEntries(books.map((b) => {
      const ov = overrideByBook[b.id]?.[p.id];
      if (!isSystemPriceBook(b)) return [b.id, ov != null ? Number(ov) : null];
      return [b.id, resolvePriceBookPrice(b, {
        retailPrice: Number(p.baseRetailPrice),
        costPrice: includePurchasePrices ? Number(p.costPrice) : null,
        lastPurchaseNetPrice: includePurchasePrices && p.lastPurchaseNetPrice != null ? Number(p.lastPurchaseNetPrice) : null,
      }, ov)];
    })) as Record<string, number | null>,
  }));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="shrink-0 text-sm font-bold">{t("pricing.booksCount", { n: books.length })}</h2>
        <ListSearchFilterBar
          search={<InstantProductSearch value={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} />}
          filter={<InventoryFilterDrawer title="Bộ lọc thiết lập giá" values={params} countEndpoint="" fields={["category", "brand", "supplier", "kind", "status", "stock", "sort"]} categories={categories.map((item) => ({ value: item.id, label: item.name }))} brands={brands.map((item) => ({ value: item.id, label: item.name }))} suppliers={suppliers.map((item) => ({ value: item.id, label: item.name }))} />}
        />
      </div>
      <PricingTable
        key={JSON.stringify([context.storeId, books, params])}
        books={books}
        rows={tableRows}
        total={total}
        filters={filters}
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
