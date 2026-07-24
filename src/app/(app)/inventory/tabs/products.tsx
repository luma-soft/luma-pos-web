import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus, PackageOpen } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getProduct, getProducts, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { ProductsTable } from "./products-table";
import { NewProductForm } from "../../products/new/product-form";
import { productToFormInitialValues } from "../../products/product-form-values";
import { ShopeeListingModal } from "./shopee-listing-modal";
import { CAMERA_QUOTE_DETAIL_MATERIAL_SKUS, CAMERA_QUOTE_MATERIAL_SKUS } from "@/lib/data/camera-quote-constants";
import { CameraMaterialSearch } from "./camera-material-search";
import { InstantProductSearch } from "./instant-product-search";
import { InstantProductFilters } from "./instant-product-filters";

type SP = Record<string, string | undefined>;
const STATUSES = ["active", "inactive", "all"] as const;
type Status = (typeof STATUSES)[number];
const VIEWS = ["grouped", "flat"] as const;
type View = (typeof VIEWS)[number];
const PRODUCT_MODAL_KEYS = ["productModal", "productId", "copyFrom", "sameTypeAs", "onlineListing", "onlineProductId", "shopeeProductId"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function ProductsTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const cameraMaterials = params.cameraMaterials === "1";
  const { categories } = await getProductFormOptions();

  return (
    <>
      {cameraMaterials && <div className="mb-4"><h2 className="text-lg font-bold">Vật tư lắp camera</h2><p className="text-sm text-slate-500">Thêm, sửa, xóa các vật tư dùng trong báo giá lắp đặt camera.</p></div>}

      {cameraMaterials && <CameraMaterialSearch value={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} />}

      <Suspense fallback={<TableSkeleton cols={8} rows={10} />}>
        <ProductsContent searchParams={searchParams} cameraMaterials={cameraMaterials} categories={categories} />
      </Suspense>

      <ProductEditorModal searchParams={params} />
      <ShopeeListingModalShell searchParams={params} />
    </>
  );
}

async function ShopeeListingModalShell({ searchParams }: { searchParams: SP }) {
  const productId = searchParams.onlineProductId ?? searchParams.shopeeProductId;
  if (!productId && searchParams.onlineListing !== "1") return null;
  if (!productId) return <ShopeeListingModal key="new-online-listing" product={null} closeHref={productModalHref(searchParams, {})} />;
  if (!UUID_RE.test(productId)) notFound();
  const product = await getProduct(productId);
  if (!product) notFound();
  return <ShopeeListingModal key={product.id} product={product} closeHref={productModalHref(searchParams, {})} />;
}

async function ProductsToolbar({
  params,
  categories,
  status,
  view,
}: {
  params: SP;
  categories: Awaited<ReturnType<typeof getProductFormOptions>>["categories"];
  status: Status;
  view: View;
}) {
  const t = await getTranslations();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <InstantProductSearch value={params.q ?? ""} placeholder={t("products.list.searchPlaceholder")} />
      <InstantProductFilters category={params.category ?? ""} status={status} view={view} categories={categories} labels={{ allCategories: t("products.list.allCategories"), active: t("products.list.statusActive"), inactive: t("products.list.statusInactive"), all: t("products.list.statusAll"), grouped: t("products.list.viewGrouped"), flat: t("products.list.viewFlat") }} />
      <Link href={productModalHref(params, { productModal: "create" })} className="inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98]"><Plus className="w-4 h-4" />{t("products.createNew")}</Link>
    </div>
  );
}

export async function ProductEditorModal({
  searchParams,
  closeHrefOverride,
}: {
  searchParams: SP;
  closeHrefOverride?: string;
}) {
  const modal = searchParams.productModal;
  if (!modal) return null;
  if (!["create", "edit", "copy", "sameType"].includes(modal)) return null;

  const editId = modal === "edit" ? searchParams.productId : undefined;
  const copyFrom = modal === "copy" ? searchParams.copyFrom : undefined;
  const sameTypeAs = modal === "sameType" ? searchParams.sameTypeAs : undefined;
  const seedId = editId ?? copyFrom ?? sameTypeAs;
  if (seedId && !UUID_RE.test(seedId)) notFound();

  const [options, priceBooks, seedProduct] = await Promise.all([
    getProductFormOptions(),
    getPriceBooks(),
    seedId ? getProduct(seedId) : Promise.resolve(null),
  ]);
  if (seedId && !seedProduct) notFound();

  const priceOverridesByBook = seedProduct ? await getPriceOverridesForProducts([seedProduct.id]) : {};
  const priceBookPrices = seedProduct
    ? Object.fromEntries(Object.entries(priceOverridesByBook).map(([bookId, prices]) => [bookId, prices[seedProduct.id]]))
    : {};
  const closeHref = closeHrefOverride ?? productModalHref(searchParams, {});
  const mode = modal === "edit" ? "edit" : "create";
  const initialValues = seedProduct
    ? productToFormInitialValues(seedProduct, modal === "copy" ? "copy" : modal === "sameType" ? "sameType" : "edit", priceBookPrices)
    : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-2 sm:p-5">
      <div className="h-[min(92dvh,920px)] w-full max-w-7xl overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <NewProductForm
          mode={mode}
          productId={editId}
          isVariantChild={Boolean(seedProduct?.parentProductId)}
          siblingCount={seedProduct?.siblings.length ?? 0}
          initialValues={initialValues}
          categories={options.categories}
          brands={options.brands}
          suppliers={options.suppliers}
          priceBooks={priceBooks}
          layout="modal"
          closeHref={closeHref}
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

async function ProductsContent({ searchParams, cameraMaterials = false, categories = [] }: { searchParams: SP; cameraMaterials?: boolean; categories?: Awaited<ReturnType<typeof getProductFormOptions>>["categories"] }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const status: Status = STATUSES.includes(params.status as Status) ? (params.status as Status) : "active";
  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "grouped";

  const { rows, total, pageCount } = await getProducts({
    q: params.q,
    categoryId: params.category,
    status,
    view,
    page,
    pageSize,
    productSkus: cameraMaterials ? [...CAMERA_QUOTE_MATERIAL_SKUS, ...CAMERA_QUOTE_DETAIL_MATERIAL_SKUS] : undefined,
    cameraMaterial: cameraMaterials,
  });

  return (
    <>
      {!cameraMaterials && <ProductsToolbar params={params} categories={categories} status={status} view={view} />}
      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <PackageOpen className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("products.list.empty")}</p>
          <p className="text-sm mt-1">{t("products.list.emptyHint")}</p>
        </div>
      ) : (
        <>
          <ProductsTable rows={rows} />
        </>
      )}

      <div className="shrink-0 pt-3">
        <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
      </div>
    </>
  );
}
