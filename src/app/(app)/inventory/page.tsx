import { getTranslations } from "next-intl/server";
import { Text } from "@/components/ui/text";
import { StockTab } from "./tabs/stock";
import { ProductsTab } from "./tabs/products";
import { PricingTab } from "./tabs/pricing";
import { PurchasesTab } from "./tabs/purchases";
import { PurchaseReturnsTab } from "./tabs/purchase-returns";
import { StocktakesTab } from "./tabs/stocktakes";
import { InternalUseTab } from "./tabs/internal-use";
import { InventoryNavigation } from "./inventory-navigation";
import { StockActionMenu } from "./tabs/stock-actions";

export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const requestedTab = params.tab ?? "products";
  const tab = requestedTab === "categories" ? "products" : requestedTab;
  const effectiveParams = requestedTab === "categories"
    ? { ...params, tab: "products", catalog: "categories" }
    : params;

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-border bg-surface sm:-mx-6 sm:-mt-6 lg:mb-5">
        <div className="flex min-h-[68px] items-center gap-3 px-4 pt-2 sm:px-6 lg:min-h-13 lg:pt-2.5">
          <div className="min-w-0 flex-1">
            <Text as="h1" weight="bold" className="text-xl tracking-[-0.01em] lg:text-[17px]" text={t("nav.groups.inventory")} />
            <Text as="p" variant="muted" className="mt-0.5 text-xs font-semibold lg:hidden" text={t("mobile.inventory.subtitle")} />
          </div>
          {tab === "stock" && <div className="hidden lg:block"><StockActionMenu /></div>}
        </div>
        <div className="overflow-x-auto px-4 pb-2 sm:px-6"><InventoryNavigation activeTab={tab} /></div>
      </div>

      {tab === "products" || tab === "camera-materials" ? <ProductsTab searchParams={tab === "camera-materials" ? { ...effectiveParams, cameraMaterials: "1" } : effectiveParams} />
        : tab === "pricing" ? <PricingTab searchParams={params} />
        : tab === "purchases" ? <PurchasesTab searchParams={params} />
        : tab === "purchase-returns" ? <PurchaseReturnsTab searchParams={params} />
        : tab === "internal" ? <InternalUseTab searchParams={params} />
        : tab === "stocktakes" ? <StocktakesTab searchParams={params} />
        : <StockTab searchParams={params} />}
    </div>
  );
}
