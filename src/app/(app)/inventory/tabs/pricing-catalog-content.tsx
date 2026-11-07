"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { parsePageSize } from "@/lib/pagination";
import { parsePricingSort } from "@/lib/pricing/pricing-policy";
import { parsePriceComparisonParams } from "@/lib/pricing/price-comparison";
import { sortProductsBySort } from "@/lib/product-sort-policy";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";
import { InstantProductSearch } from "./instant-product-search";
import { ListSearchFilterBar } from "@/components/list-search-filter";
import { PricingTable, type PricingBook, type PricingRow } from "../../pricing/pricing-table";
import { toPricingRow } from "../../pricing/pricing-rows";
import type { PriceFormulaFilters } from "@/lib/pricing/price-edit";

type SearchParams = Record<string, string | undefined>;

export function PricingCatalogContent({
  books,
  searchParams,
  formulaFilters,
  canViewPurchasePrices,
  canEditCostPrice,
}: {
  books: PricingBook[];
  searchParams: SearchParams;
  formulaFilters: PriceFormulaFilters;
  canViewPurchasePrices: boolean;
  canEditCostPrice: boolean;
}) {
  const t = useTranslations();
  const catalog = useProductCatalog();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const pageSize = parsePageSize(searchParams.size);
  const sort = parsePricingSort(searchParams.sort, catalog.defaultSort);
  const query = searchParams.q?.trim() ?? "";
  const comparison = parsePriceComparisonParams(searchParams);
  const categories = catalog.snapshot?.metadata?.categories ?? [];
  const brands = catalog.snapshot?.metadata?.brands ?? [];
  const suppliers = catalog.snapshot?.metadata?.suppliers ?? [];

  const matchingProducts = useMemo(() => {
    const searchRows = query
      ? catalog.search(query, { limit: catalog.products.length, sort })
      : catalog.products;
    const lifecycle = searchParams.lifecycle
      || (searchParams.status === "inactive" ? "paused" : searchParams.status)
      || "active";
    const kind = searchParams.productKind;
    const stockFilter = ({ instock: "available", low: "lowStock", out: "outOfStock" } as Record<string, string>)[searchParams.stock ?? ""]
      ?? searchParams.stock;
    const categoryIds = (searchParams.categoryIds ?? searchParams.category)?.split(",").filter(Boolean) ?? [];
    const brandIds = (searchParams.brandIds ?? searchParams.brandId)?.split(",").filter(Boolean) ?? [];
    const supplierIds = (searchParams.supplierIds ?? searchParams.supplierId)?.split(",").filter(Boolean) ?? [];
    const priceAgainst = canViewPurchasePrices ? comparison.priceAgainst : undefined;

    return searchRows.filter((product) => {
      if (product.isVariantParent) return false;
      const status = product.lifecycleStatus ?? (product.isActive === false ? "paused" : "active");
      if (lifecycle === "active" && (status !== "active" || product.isActive === false)) return false;
      if (lifecycle === "paused" && (status !== "active" || product.isActive !== false)) return false;
      if (["draft", "archived"].includes(lifecycle) && status !== lifecycle) return false;
      if (categoryIds.length && !categoryIds.includes(product.categoryId ?? "")) return false;
      if (brandIds.length && !brandIds.includes(product.brandId ?? "")) return false;
      if (supplierIds.length && !supplierIds.some((id) => product.supplierId === id || product.supplierIDs?.includes(id))) return false;
      if (kind === "variant" && !product.parentProductId) return false;
      if (["product", "service", "combo"].includes(kind ?? "") && product.productKind !== kind) return false;

      const stock = Number(product.totalStock ?? 0);
      const minimum = Number(product.minStock ?? 0);
      if (stockFilter === "negativeStock" && stock >= 0) return false;
      if (stockFilter === "outOfStock" && stock !== 0) return false;
      if (stockFilter === "lowStock" && !(stock > 0 && stock < minimum)) return false;
      if (stockFilter === "inStock" && !(stock > 0 && stock >= minimum)) return false;
      if (stockFilter === "available" && stock <= 0) return false;

      if (priceAgainst && comparison.priceCondition) {
        const priceBookId = comparison.priceBookId;
        const bookType = priceBookId ? product.priceBookTypes?.[priceBookId] : null;
        const selling = !priceBookId ? Number(product.retailPrice)
          : bookType === "cost" ? Number(product.costPrice ?? 0)
            : bookType === "purchase" ? Number(product.lastPurchaseNetPrice ?? NaN)
              : Number(product.prices[priceBookId] ?? product.retailPrice);
        const reference = priceAgainst === "cost"
          ? Number(product.costPrice ?? NaN)
          : Number(product.lastPurchaseNetPrice ?? NaN);
        if (!Number.isFinite(selling) || !Number.isFinite(reference)) return false;
        const matches = comparison.priceCondition === "lt" ? selling < reference
          : comparison.priceCondition === "lte" ? selling <= reference
            : comparison.priceCondition === "eq" ? selling === reference
              : comparison.priceCondition === "gte" ? selling >= reference
                : selling > reference;
        if (!matches) return false;
      }
      return true;
    });
  }, [canViewPurchasePrices, catalog, comparison, query, searchParams, sort]);

  const sortedProducts = useMemo(() => sortProductsBySort(matchingProducts, sort), [matchingProducts, sort]);
  const total = sortedProducts.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rows = useMemo<PricingRow[]>(() => sortedProducts
    .slice((page - 1) * pageSize, page * pageSize)
    .map((product) => toPricingRow(product, books, canViewPurchasePrices)),
  [books, canViewPurchasePrices, page, pageSize, sortedProducts]);

  if (!catalog.snapshot) {
    if (catalog.status === "loading") return <TableSkeleton cols={4} rows={10} />;
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
        <p className="font-semibold">Không có danh mục sản phẩm ngoại tuyến</p>
        <p className="mt-1 text-sm text-slate-500">Kết nối mạng để đồng bộ danh mục lần đầu.</p>
        <button type="button" onClick={() => void catalog.refresh()} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">Thử đồng bộ</button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="shrink-0 text-sm font-bold">{t("pricing.booksCount", { n: books.length })}</h2>
        <ListSearchFilterBar
          search={<InstantProductSearch value={query} placeholder={t("products.list.searchPlaceholder")} />}
          filter={<InventoryFilterDrawer
            title="Bộ lọc thiết lập giá"
            values={searchParams}
            resultCount={total}
            defaultSort={catalog.defaultSort}
            countEndpoint="/api/inventory/pricing/count"
            showPriceComparison={canViewPurchasePrices}
            fields={["category", "brand", "supplier", "kind", "status", "stock", "sort", "price"]}
            categories={categories.map((item) => ({ value: item.id, label: item.name }))}
            brands={brands.map((item) => ({ value: item.id, label: item.name }))}
            suppliers={suppliers.map((item) => ({ value: item.id, label: item.name }))}
          />}
        />
      </div>
      <PricingTable
        key={JSON.stringify([books, searchParams])}
        books={books}
        rows={rows}
        total={total}
        filters={formulaFilters}
        canViewPurchasePrices={canViewPurchasePrices}
        canEditCostPrice={canEditCostPrice}
        resetScrollKey={[
          searchParams.q,
          searchParams.category,
          searchParams.brandId,
          searchParams.supplierId,
          searchParams.productKind,
          searchParams.stock,
          searchParams.sort,
          searchParams.status,
          page,
          pageSize,
        ].join("\u0000")}
      />
      <Pagination page={Math.min(page, pageCount)} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
    </>
  );
}
