import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PackageOpen } from "lucide-react";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { getProduct, getProducts, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { ProductsTable } from "./products-table";
import { NewProductForm } from "../../products/new/product-form";
import { productToFormInitialValues, resolveProductFormSeed } from "../../products/product-form-values";
import { ShopeeListingModal } from "./shopee-listing-modal";
import { CAMERA_QUOTE_DETAIL_MATERIAL_SKUS, CAMERA_QUOTE_MATERIAL_SKUS } from "@/lib/data/camera-quote-constants";
import { CameraMaterialSearch } from "./camera-material-search";
import { InstantProductSearch } from "./instant-product-search";
import { InventoryFilterDrawer } from "./inventory-filter-drawer";
import { ProductCreateMenu } from "./product-create-menu";
import {
  ProductBulkActions,
  ProductSelectionProvider,
} from "./product-selection";
import { getCategoriesWithCounts } from "@/lib/data/categories";
import { CategoriesManager } from "../../products/categories/categories-manager";
import { ProductCatalogSwitcher } from "./product-catalog-switcher";
import { ListSearchFilterBar } from "@/components/list-search-filter";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getPublicMediaConfig } from "@/lib/media/config";
import {
  DEFAULT_PRODUCT_LIST_SORT,
  parseProductListSort,
} from "@/lib/inventory/product-list-policy";

type SP = Record<string, string | undefined>;
const STATUSES = ["active", "inactive", "all"] as const;
type Status = (typeof STATUSES)[number];
const VIEWS = ["grouped", "flat"] as const;
type View = (typeof VIEWS)[number];
const PRODUCT_MODAL_KEYS = ["productModal", "productId", "copyFrom", "copyGroup", "sameTypeAs", "productKind", "onlineListing", "onlineProductId", "shopeeProductId"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function ProductsTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const params = searchParams;
  const cameraMaterials = params.cameraMaterials === "1";
  const catalogView = params.catalog === "categories" ? "categories" : "products";

  if (!cameraMaterials && catalogView === "categories") {
    const page = Number(params.page) || 1;
    const pageSize = parsePageSize(params.size);
    const [categoryData, productData] = await Promise.all([
      getCategoriesWithCounts(context.storeId, { page, pageSize }),
      getProducts(context.storeId, { status: "active", view: "grouped", sort: DEFAULT_PRODUCT_LIST_SORT, page: 1, pageSize: 15 }),
    ]);
    return (
      <>
        <ProductCatalogSwitcher activeView="categories" productCount={productData.total} categoryCount={categoryData.total} />
        <CategoriesManager categories={categoryData.rows} parentOptions={categoryData.roots} total={categoryData.total} />
        <Pagination page={page} pageCount={categoryData.pageCount} total={categoryData.total} pageSize={pageSize} unitLabel={t("categories.unitLabel")} />
      </>
    );
  }

  const options = await getProductFormOptions(context.storeId);
  const { categories } = options;

  return (
    <>
      {cameraMaterials && <div className="mb-4"><h2 className="text-lg font-bold">Vật tư lắp camera</h2><p className="text-sm text-slate-500">Thêm, sửa, xóa các vật tư dùng trong báo giá lắp đặt camera.</p></div>}

      {cameraMaterials && <CameraMaterialSearch value={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} />}

      <Suspense fallback={<TableSkeleton cols={8} rows={10} />}>
        <ProductsContent searchParams={searchParams} cameraMaterials={cameraMaterials} categories={categories} brands={options.brands} suppliers={options.suppliers} />
      </Suspense>

      <ProductEditorModal searchParams={params} />
      {ONLINE_SALES_ENABLED && <ShopeeListingModalShell searchParams={params} />}
    </>
  );
}

async function ShopeeListingModalShell({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const productId = searchParams.onlineProductId ?? searchParams.shopeeProductId;
  if (!productId && searchParams.onlineListing !== "1") return null;
  if (!productId) return <ShopeeListingModal key="new-online-listing" product={null} closeHref={productModalHref(searchParams, {})} />;
  if (!UUID_RE.test(productId)) notFound();
  const product = await getProduct(context.storeId, productId);
  if (!product) notFound();
  return <ShopeeListingModal key={product.id} product={product} closeHref={productModalHref(searchParams, {})} />;
}

async function ProductsToolbar({
  params,
  categories,
  brands,
  suppliers,
  resultCount,
}: {
  params: SP;
  categories: Awaited<ReturnType<typeof getProductFormOptions>>["categories"];
  brands: Awaited<ReturnType<typeof getProductFormOptions>>["brands"];
  suppliers: Awaited<ReturnType<typeof getProductFormOptions>>["suppliers"];
  resultCount: number;
}) {
  const t = await getTranslations();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
      <ListSearchFilterBar
        search={<InstantProductSearch value={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} />}
        filter={<InventoryFilterDrawer title="Bộ lọc sản phẩm" values={params} resultCount={resultCount} defaultSort={DEFAULT_PRODUCT_LIST_SORT} fields={["category", "brand", "supplier", "kind", "status", "stock", "sort", "view"]} categories={categories.map((item) => ({ value: item.id, label: item.name }))} brands={brands.map((item) => ({ value: item.id, label: item.name }))} suppliers={suppliers.map((item) => ({ value: item.id, label: item.name }))} />}
      />
      <ProductCreateMenu
        label={t("products.createNew")}
        items={[
          {
            kind: "product",
            label: t("products.kind.labels.product"),
            hint: t("products.kind.hints.product"),
            href: productModalHref(params, { productModal: "create", productKind: "product" }),
          },
          {
            kind: "service",
            label: t("products.kind.labels.service"),
            hint: t("products.kind.hints.service"),
            href: productModalHref(params, { productModal: "create", productKind: "service" }),
          },
          {
            kind: "combo",
            label: t("products.kind.labels.combo"),
            hint: t("products.kind.hints.combo"),
            href: productModalHref(params, { productModal: "create", productKind: "combo" }),
          },
        ]}
      />
      <ProductBulkActions />
    </div>
  );
}

export async function ProductEditorModal({
  searchParams,
  closeHrefOverride,
  closeNavigation,
}: {
  searchParams: SP;
  closeHrefOverride?: string;
  closeNavigation?: "push" | "replace";
}) {
  const context = await requireStoreContext();
  const publicMedia = getPublicMediaConfig();
  const modal = searchParams.productModal;
  if (!modal) return null;
  if (!["create", "edit", "copy", "sameType", "groupEdit", "groupAdd"].includes(modal)) return null;

  const editId = modal === "edit" || modal === "groupEdit" ? searchParams.productId : undefined;
  const copyFrom = modal === "copy" ? searchParams.copyFrom : undefined;
  const sameTypeAs = modal === "sameType" || modal === "groupAdd" ? searchParams.sameTypeAs : undefined;
  const seedId = editId ?? copyFrom ?? sameTypeAs;
  if (seedId && !UUID_RE.test(seedId)) notFound();

  const [options, priceBooks, requestedProduct] = await Promise.all([
    getProductFormOptions(context.storeId),
    getPriceBooks(context.storeId),
    seedId ? getProduct(context.storeId, seedId) : Promise.resolve(null),
  ]);
  if (seedId && !requestedProduct) notFound();
  const seedMode = modal === "copy" ? (searchParams.copyGroup === "1" ? "groupCopy" : "copy") : modal === "sameType" || modal === "groupAdd" ? "groupAdd" : modal === "groupEdit" ? "groupEdit" : "edit";
  const seedProduct = requestedProduct ? await resolveProductFormSeed(requestedProduct, seedMode, (productId) => getProduct(context.storeId, productId)) : null;
  if (seedId && !seedProduct) notFound();

  const priceOverridesByBook = seedProduct ? await getPriceOverridesForProducts(context.storeId, [seedProduct.id]) : {};
  const priceBookPrices = seedProduct
    ? Object.fromEntries(Object.entries(priceOverridesByBook).map(([bookId, prices]) => [bookId, prices[seedProduct.id]]))
    : {};
  const closeHref = closeHrefOverride ?? productModalHref(searchParams, {});
  const mode = modal === "edit" || modal === "groupEdit" ? "edit" : "create";
  const requestedKind = ["product", "service", "combo"].includes(searchParams.productKind ?? "")
    ? searchParams.productKind as "product" | "service" | "combo"
    : "product";
  const initialValues = seedProduct
    ? productToFormInitialValues(seedProduct, seedMode, priceBookPrices, publicMedia)
    : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-0 sm:p-5">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-editor-title"
        className="h-dvh w-full max-w-7xl overflow-hidden bg-surface shadow-2xl sm:h-[min(92dvh,920px)] sm:rounded-2xl"
      >
        <NewProductForm
          storeId={context.storeId}
          publicMediaBaseUrl={publicMedia.publicBaseUrl}
          mode={mode}
          productId={mode === "edit" ? seedProduct?.id : undefined}
          isVariantChild={Boolean(seedProduct?.parentProductId)}
          siblingCount={seedProduct?.siblings.length ?? 0}
          initialValues={initialValues}
          variantGroup={seedProduct?.variantGroup}
          initialManagedImages={mode === "edit" ? seedProduct?.imageMedia : undefined}
          categories={options.categories}
          brands={options.brands}
          suppliers={options.suppliers}
          comboProducts={options.comboProducts}
          priceBooks={priceBooks}
          layout="modal"
          closeHref={closeHref}
          closeNavigation={closeNavigation}
          creationKind={seedProduct?.productKind ?? requestedKind}
        />
      </div>
    </div>
  );
}

function productModalHref(params: SP, patch: Record<string, string>) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value || PRODUCT_MODAL_KEYS.includes(key as (typeof PRODUCT_MODAL_KEYS)[number])) continue;
    sp.set(key, value);
  }
  sp.set("tab", "products");
  for (const [key, value] of Object.entries(patch)) sp.set(key, value);
  return `${Routes.Inventory}?${sp.toString()}`;
}

async function ProductsContent({ searchParams, cameraMaterials = false, categories = [], brands = [], suppliers = [] }: { searchParams: SP; cameraMaterials?: boolean; categories?: Awaited<ReturnType<typeof getProductFormOptions>>["categories"]; brands?: Awaited<ReturnType<typeof getProductFormOptions>>["brands"]; suppliers?: Awaited<ReturnType<typeof getProductFormOptions>>["suppliers"] }) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const status: Status = STATUSES.includes(params.status as Status) ? (params.status as Status) : "active";
  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "grouped";

  const { rows, total, pageCount } = await getProducts(context.storeId, {
    q: params.q,
    categoryId: params.category,
    brandId: params.brandId,
    supplierId: params.supplierId,
    productKind: params.productKind as "product" | "service" | "combo" | undefined,
    stock: params.stock as "instock" | "low" | "out" | undefined,
    sort: parseProductListSort(params.sort),
    status,
    view,
    page,
    pageSize,
    productSkus: cameraMaterials ? [...CAMERA_QUOTE_MATERIAL_SKUS, ...CAMERA_QUOTE_DETAIL_MATERIAL_SKUS] : undefined,
    cameraMaterial: cameraMaterials,
  });

  return (
    <ProductSelectionProvider visibleIds={[...new Set(rows.flatMap((row) => view === "grouped" && row.variantGroup ? row.variantGroup.members.filter((member) => !member.isVariantParent).map((member) => member.id) : row.isVariantParent ? [] : [row.id]))]}>
      {!cameraMaterials && <ProductCatalogSwitcher activeView="products" productCount={total} categoryCount={categories.length} />}
      {!cameraMaterials && (
        <div className="mb-3 lg:hidden">
          <h2 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">{t("products.title")}</h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{total.toLocaleString("vi-VN")} SKU</p>
        </div>
      )}
      {!cameraMaterials && <ProductsToolbar params={params} categories={categories} brands={brands} suppliers={suppliers} resultCount={total} />}
      <ProductsTable
        rows={rows}
        grouped={view === "grouped" && !cameraMaterials}
        resetScrollKey={[
          params.q,
          params.category,
          params.brandId,
          params.supplierId,
          params.productKind,
          params.stock,
          params.sort,
          status,
          view,
          page,
          pageSize,
        ].join("\u0000")}
        selectionEnabled={!cameraMaterials}
        empty={(
          <div className="rounded-card border border-dashed border-border bg-surface p-12 text-center text-slate-400">
            <PackageOpen className="w-10 h-10 mx-auto mb-3 opacity-60" />
            <p className="font-medium">{t("products.list.empty")}</p>
            <p className="text-sm mt-1">{t("products.list.emptyHint")}</p>
          </div>
        )}
      />

      <div className="shrink-0 pt-3">
        <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
      </div>
    </ProductSelectionProvider>
  );
}
