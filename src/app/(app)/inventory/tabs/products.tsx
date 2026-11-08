import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { getProduct, getProductFormOptions } from "@/lib/data/products";
import { getPriceBooks, getPriceOverridesForProducts } from "@/lib/data/price-books";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { MobileInventoryCatalogSkeleton } from "@/components/mobile-inventory-catalog-skeleton";
import { NewProductForm } from "../../products/new/product-form";
import { latestVariantMemberId, productToFormInitialValues, resolveProductFormSeed } from "../../products/product-form-values";
import { ShopeeListingModal } from "./shopee-listing-modal";
import { CAMERA_QUOTE_DETAIL_MATERIAL_SKUS, CAMERA_QUOTE_MATERIAL_SKUS } from "@/lib/data/camera-quote-constants";
import { getCategoriesWithCounts } from "@/lib/data/categories";
import { CategoriesManager } from "../../products/categories/categories-manager";
import { ProductCatalogSwitcher } from "./product-catalog-switcher";
import { ProductCatalogProductsContent } from "./product-catalog-products-content";
import { requireStoreContext } from "@/lib/auth/store-context";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { getPublicMediaConfig } from "@/lib/media/config";
import { ProductModalFrame } from "@/components/product-modal-frame";
import { KeepPreviousContent } from "@/components/keep-previous-content";

type SP = Record<string, string | undefined>;
const PRODUCT_MODAL_KEYS = ["productModal", "productId", "copyFrom", "copyGroup", "sameTypeAs", "productKind", "returnTo", "onlineListing", "onlineProductId", "shopeeProductId"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ProductsTabLoading() {
  return <MobileInventoryCatalogSkeleton />;
}

export async function ProductsTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const params = searchParams;
  const cameraMaterials = params.cameraMaterials === "1";
  const catalogView = params.catalog === "categories" ? "categories" : "products";

  if (!cameraMaterials && catalogView === "categories") {
    const page = Number(params.page) || 1;
    const pageSize = parsePageSize(params.size);
    const categoryData = await getCategoriesWithCounts(context.storeId, { page, pageSize });
    return (
      <>
        <ProductCatalogSwitcher activeView="categories" categoryCount={categoryData.total} />
        <CategoriesManager categories={categoryData.rows} parentOptions={categoryData.roots} total={categoryData.total} />
        <Pagination page={page} pageCount={categoryData.pageCount} total={categoryData.total} pageSize={pageSize} unitLabel={t("categories.unitLabel")} />
      </>
    );
  }

  return (
    <>
      {cameraMaterials && <div className="mb-4"><h2 className="text-lg font-bold">Vật tư lắp camera</h2><p className="text-sm text-slate-500">Thêm, sửa, xóa các vật tư dùng trong báo giá lắp đặt camera.</p></div>}

      <KeepPreviousContent fallback={<MobileInventoryCatalogSkeleton />}>
        <ProductCatalogProductsContent
          showPriceComparison={canViewPurchasePrices(context.role)}
          cameraMaterials={cameraMaterials}
          cameraSkus={[...CAMERA_QUOTE_MATERIAL_SKUS, ...CAMERA_QUOTE_DETAIL_MATERIAL_SKUS]}
        />
      </KeepPreviousContent>

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

export async function ProductEditorModal({
  searchParams,
  closeHrefOverride,
  closeNavigation,
  cancelNavigation,
}: {
  searchParams: SP;
  closeHrefOverride?: string;
  closeNavigation?: "back" | "push" | "replace";
  cancelNavigation?: "back" | "push" | "replace";
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

  const templateId = seedMode === "groupAdd" && seedProduct ? latestVariantMemberId(seedProduct) : undefined;
  const templateProduct = templateId ? await getProduct(context.storeId, templateId) : seedProduct;
  if (seedMode === "groupAdd" && !templateProduct) notFound();
  const priceOverridesByBook = templateProduct ? await getPriceOverridesForProducts(context.storeId, [templateProduct.id]) : {};
  const priceBookPrices = templateProduct
    ? Object.fromEntries(Object.entries(priceOverridesByBook).map(([bookId, prices]) => [bookId, prices[templateProduct.id]]))
    : {};
  const returnTo = safeReturnHref(searchParams.returnTo);
  const closeHref = returnTo ?? closeHrefOverride ?? productModalHref(searchParams, {});
  const effectiveCancelNavigation = cancelNavigation ?? closeNavigation ?? "replace";
  const mode = modal === "edit" || modal === "groupEdit" ? "edit" : "create";
  const requestedKind = ["product", "service", "combo"].includes(searchParams.productKind ?? "")
    ? searchParams.productKind as "product" | "service" | "combo"
    : "product";
  const initialValues = templateProduct
    ? productToFormInitialValues(templateProduct, seedMode, priceBookPrices)
    : undefined;

  return (
    <ProductModalFrame
      labelledBy="product-editor-title"
      closeHref={closeHref}
      closeNavigation={effectiveCancelNavigation}
    >
        <NewProductForm
          key={`${modal}-${templateProduct?.id ?? "blank"}`}
          storeId={context.storeId}
          publicMediaBaseUrl={publicMedia.publicBaseUrl}
          mode={mode}
          productId={mode === "edit" ? seedProduct?.id : undefined}
          isVariantChild={Boolean(seedProduct?.parentProductId)}
          siblingCount={seedProduct?.siblings.length ?? 0}
          initialValues={initialValues}
          variantGroup={seedProduct?.variantGroup}
          variantTemplateName={seedMode === "groupAdd" ? templateProduct?.name : undefined}
          initialManagedImages={mode === "edit" || seedMode === "copy" || seedMode === "groupCopy" || seedMode === "groupAdd" ? templateProduct?.imageMedia : undefined}
          categories={options.categories}
          brands={options.brands}
          suppliers={options.suppliers}
          priceBooks={priceBooks}
          layout="modal"
          closeHref={closeHref}
          closeNavigation={closeNavigation}
          cancelNavigation={effectiveCancelNavigation}
          createdProductReturnTo={mode === "create" ? returnTo ?? undefined : undefined}
          creationKind={seedProduct?.productKind ?? requestedKind}
        />
    </ProductModalFrame>
  );
}

function safeReturnHref(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return null;
  try {
    const url = new URL(candidate, "http://luma.local");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
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
