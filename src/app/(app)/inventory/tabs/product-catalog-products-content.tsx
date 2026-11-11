"use client";

import { useCallback, useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { ListSearchFilterBar } from "@/components/list-search-filter";
import { Pagination } from "@/components/pagination";
import { MobileInventoryCatalogSkeleton } from "@/components/mobile-inventory-catalog-skeleton";
import { parsePageSize } from "@/lib/pagination";
import { parsePriceComparisonParams } from "@/lib/pricing/price-comparison";
import { parseProductListSort } from "@/lib/inventory/product-list-policy";
import { Routes } from "@/lib/routes";
import { exploreProductCatalog, productCatalogMatches, visibleProductSelections } from "@/lib/product-catalog-explorer";
import { ProductCatalogSwitcher } from "./product-catalog-switcher";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";
import { InstantProductSearch } from "./instant-product-search";
import { ProductCreateMenu } from "./product-create-menu";
import { ProductBulkActions, ProductSelectionProvider } from "./product-selection";
import { ProductsTable } from "./products-table";

type Props = {
  showPriceComparison: boolean;
  cameraMaterials?: boolean;
  cameraSkus?: readonly string[];
};

function readStatus(value: string | null): "active" | "inactive" | "draft" | "archived" | "all" {
  return value === "inactive" || value === "draft" || value === "archived" || value === "all" ? value : "active";
}

export function ProductCatalogProductsContent({ showPriceComparison, cameraMaterials = false, cameraSkus = [] }: Props) {
  const t = useTranslations();
  const params = useSearchParams();
  const catalog = useProductCatalog();
  const urlQuery = params.get("q") ?? "";
  const filterKey = params.toString();
  const canonicalProducts = catalog.snapshot?.products ?? catalog.products;
  const [searchState, setSearchState] = useState({ source: urlQuery, value: urlQuery });
  const query = searchState.source === urlQuery ? searchState.value : urlQuery;
  const [paginationState, setPaginationState] = useState({
    source: filterKey,
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: parsePageSize(params.get("size") ?? undefined),
  });
  const page = paginationState.source === filterKey ? paginationState.page : Math.max(1, Number(params.get("page")) || 1);
  const pageSize = paginationState.source === filterKey ? paginationState.pageSize : parsePageSize(params.get("size") ?? undefined);
  const setLocalQuery = (value: string) => {
    setSearchState({ source: urlQuery, value });
    setPaginationState({ source: filterKey, page: 1, pageSize });
  };
  const setLocalPage = (nextPage: number) => setPaginationState({ source: filterKey, page: nextPage, pageSize });
  const setLocalPageSize = (nextPageSize: number) => setPaginationState({ source: filterKey, page: 1, pageSize: nextPageSize });

  const filterValues = useMemo(() => Object.fromEntries(new URLSearchParams(filterKey).entries()), [filterKey]);
  const status = readStatus(params.get("status"));
  const view = params.get("view") === "flat" ? "flat" : "grouped";
  const priceComparison = useMemo(
    () => showPriceComparison ? parsePriceComparisonParams(new URLSearchParams(filterKey)) : {},
    [filterKey, showPriceComparison],
  );
  const filters = useMemo(() => ({
    query,
    categoryId: params.get("category") ?? undefined,
    brandId: params.get("brandId") ?? undefined,
    supplierId: params.get("supplierId") ?? undefined,
    productKind: ["product", "service", "combo"].includes(params.get("productKind") ?? "")
      ? params.get("productKind") as "product" | "service" | "combo"
      : undefined,
    stock: ["instock", "low", "out"].includes(params.get("stock") ?? "")
      ? params.get("stock") as "instock" | "low" | "out"
      : undefined,
    status,
    view: view === "flat" ? "flat" as const : "grouped" as const,
    sort: parseProductListSort(params.get("sort"), catalog.defaultSort),
    page,
    pageSize,
    cameraMaterials,
    cameraSkus: new Set(cameraSkus),
    ...priceComparison,
  }), [cameraMaterials, cameraSkus, catalog.defaultSort, page, pageSize, params, priceComparison, query, status, view]);
  const result = useMemo(() => exploreProductCatalog(
    canonicalProducts,
    catalog.snapshot?.warehouses ?? [],
    filters,
  ), [canonicalProducts, catalog.snapshot?.warehouses, filters]);

  const localFilterCount = useCallback((draft: Record<string, string>, search: string) => productCatalogMatches(
    canonicalProducts,
    catalog.snapshot?.warehouses ?? [],
    {
      query: search,
      categoryId: draft.category || undefined,
      brandId: draft.brand || undefined,
      supplierId: draft.supplier || undefined,
      productKind: ["product", "service", "combo"].includes(draft.kind)
        ? draft.kind as "product" | "service" | "combo"
        : undefined,
      status: readStatus(draft.status || "active"),
      stock: ["instock", "low", "out"].includes(draft.stock)
        ? draft.stock as "instock" | "low" | "out"
        : undefined,
      sort: parseProductListSort(draft.sort, catalog.defaultSort),
      view: draft.view === "flat" ? "flat" : "grouped",
      cameraMaterials,
      cameraSkus: new Set(cameraSkus),
      ...(showPriceComparison ? {
        priceCondition: draft.priceCondition as "lt" | "lte" | "eq" | "gte" | "gt" | undefined,
        priceAgainst: draft.priceAgainst as "cost" | "lastPurchase" | undefined,
        priceBookId: draft.priceBookId || undefined,
      } : {}),
    },
  ), [cameraMaterials, cameraSkus, canonicalProducts, catalog.defaultSort, catalog.snapshot?.warehouses, showPriceComparison]);

  const metadata = catalog.snapshot?.metadata;
  const categories = metadata?.categories ?? [];
  const brands = metadata?.brands ?? [];
  const suppliers = metadata?.suppliers ?? [];

  if (!catalog.snapshot) {
    if (catalog.status === "loading") return <MobileInventoryCatalogSkeleton />;
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
        <p className="font-semibold">Không có danh mục sản phẩm ngoại tuyến</p>
        <p className="mt-1 text-sm text-slate-500">Kết nối mạng để đồng bộ danh mục lần đầu.</p>
        <button type="button" onClick={() => void catalog.refresh()} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white">Thử đồng bộ</button>
      </div>
    );
  }

  const visibleProducts = visibleProductSelections(result.rows, view === "grouped" && !cameraMaterials, status);
  const filterOptions = <T extends { id: string; name: string }>(items: T[]) => items.map((item) => ({ value: item.id, label: item.name }));

  return (
    <ProductSelectionProvider visibleProducts={visibleProducts}>
      {!cameraMaterials && <ProductCatalogSwitcher activeView="products" productCount={result.total} categoryCount={categories.length} />}
      {!cameraMaterials && (
        <div className="mb-3 lg:hidden">
          <h2 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">{t("products.title")}</h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{result.total.toLocaleString("vi-VN")} {t("products.unitLabel")}</p>
        </div>
      )}
      {cameraMaterials ? (
        <div className="mb-4"><InstantProductSearch value={query} onQueryChange={setLocalQuery} placeholder={t("products.list.searchPlaceholder")} /></div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
          <ListSearchFilterBar
            search={<InstantProductSearch value={query} onQueryChange={setLocalQuery} placeholder={t("products.list.searchPlaceholder")} />}
            filter={<InventoryFilterDrawer
              title="Bộ lọc sản phẩm"
              values={filterValues}
              resultCount={result.total}
              defaultSort={catalog.defaultSort}
              showPriceComparison={showPriceComparison}
              fields={["category", "brand", "supplier", "kind", "status", "stock", "sort", "view", "price"]}
              categories={filterOptions(categories)}
              brands={filterOptions(brands)}
              suppliers={filterOptions(suppliers)}
              queryValue={query}
              localCount={localFilterCount}
              useLocalOptions
            />}
          />
          <ProductCreateMenu
            label={t("products.createNew")}
            showLabel
            items={(["product", "service", "combo"] as const).map((kind) => ({
              kind,
              label: t(`products.kind.labels.${kind}`),
              hint: t(`products.kind.hints.${kind}`),
              href: createProductHref(filterValues, kind),
            }))}
          />
          <ProductBulkActions />
        </div>
      )}
      <ProductsTable
        rows={result.rows}
        grouped={view === "grouped" && !cameraMaterials}
        queryOverride={query}
        resetScrollKey={[query, params.get("category"), params.get("brandId"), params.get("supplierId"), params.get("productKind"), params.get("stock"), params.get("sort"), status, view, page, pageSize].join("\u0000")}
        selectionEnabled={!cameraMaterials}
        empty={(
          <div className="rounded-card border border-dashed border-border bg-surface p-12 text-center text-slate-400">
            <PackageOpen className="mx-auto mb-3 h-10 w-10 opacity-60" />
            <p className="font-medium">{t("products.list.empty")}</p>
            <p className="mt-1 text-sm">{t("products.list.emptyHint")}</p>
          </div>
        )}
      />
      <div className="shrink-0 pt-3">
        <Pagination
          page={Math.min(page, result.pageCount)}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={pageSize}
          unitLabel={t("products.unitLabel")}
          onPageChange={setLocalPage}
          onPageSizeChange={setLocalPageSize}
        />
      </div>
    </ProductSelectionProvider>
  );
}

function createProductHref(params: Record<string, string>, kind: "product" | "service" | "combo") {
  const search = new URLSearchParams(params);
  for (const key of ["productModal", "productId", "copyFrom", "copyGroup", "sameTypeAs", "detailProductId", "detailTab"]) search.delete(key);
  search.set("tab", "products");
  search.set("productModal", "create");
  search.set("productKind", kind);
  return `${Routes.Inventory}?${search.toString()}`;
}
