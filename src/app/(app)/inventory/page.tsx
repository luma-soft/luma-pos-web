import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { Text } from "@/components/ui/text";
import { StockTab } from "./tabs/stock";
import { ProductsTab, ProductsTabLoading } from "./tabs/products";
import { PricingTab } from "./tabs/pricing";
import { PurchasesTab } from "./tabs/purchases";
import { PurchaseReturnsTab } from "./tabs/purchase-returns";
import { InternalUseTab } from "./tabs/internal-use";
import { InventoryNavigation } from "./inventory-navigation";
import { InventoryTabErrorBoundary } from "./inventory-tab-error-boundary";
import { KeepPreviousContent } from "@/components/keep-previous-content";

export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const requestedTab = params.tab ?? "products";
  if (requestedTab === "stocktakes") {
    const redirectedParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (!value || key === "tab") continue;
      redirectedParams.set(key === "q" ? "stocktakeQ" : key, value);
    }
    redirectedParams.set("tab", "stock");
    redirect(`${Routes.Inventory}?${redirectedParams.toString()}`);
  }
  const tab = requestedTab === "categories" ? "products" : requestedTab;
  const effectiveParams = requestedTab === "categories"
    ? { ...params, tab: "products", catalog: "categories" }
    : params;
  const tabTitle = requestedTab === "categories" ? t("categories.title")
    : tab === "camera-materials" ? t("inventory.cameraMaterials")
      : tab === "purchases" ? t("nav.purchases")
        : tab === "stock" ? t("inventory.warehouseTab")
          : tab === "pricing" ? t("nav.pricing")
            : tab === "purchase-returns" ? t("purchaseReturns.title")
              : tab === "internal" ? t("nav.internalUse")
                  : t("nav.products");
  const tabContent = tab === "products" || tab === "camera-materials" ? <ProductsTab searchParams={tab === "camera-materials" ? { ...effectiveParams, cameraMaterials: "1" } : effectiveParams} />
    : tab === "pricing" ? <PricingTab searchParams={params} />
      : tab === "purchases" ? <PurchasesTab searchParams={params} />
        : tab === "purchase-returns" ? <PurchaseReturnsTab searchParams={params} />
          : tab === "internal" ? <InternalUseTab searchParams={params} />
                : <StockTab searchParams={params} />;
  const showProductListLoadingBoundary =
    tab === "products" && !effectiveParams.productModal && effectiveParams.catalog !== "categories";

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-border bg-surface sm:-mx-6 sm:-mt-6 lg:mb-5">
        <div className="hidden items-center gap-3 px-4 sm:px-6 lg:flex lg:min-h-13 lg:pt-2.5">
          <div className="min-w-0 flex-1">
            <Text as="h1" weight="bold" className="text-xl tracking-[-0.01em] lg:text-[17px]" text={t("nav.groups.inventory")} />
          </div>
        </div>
        <div className="overflow-x-auto px-4 sm:px-6 lg:pb-2"><InventoryNavigation activeTab={tab} /></div>
      </div>

      <InventoryTabErrorBoundary tabTitle={tabTitle}>
        {tab === "products" && effectiveParams.catalog !== "categories" ? (
          <Suspense fallback={<ProductsTabLoading />}>
            <KeepPreviousContent
              fallback={showProductListLoadingBoundary ? <ProductsTabLoading /> : null}
            >
              {tabContent}
            </KeepPreviousContent>
          </Suspense>
        ) : tabContent}
      </InventoryTabErrorBoundary>
    </div>
  );
}
