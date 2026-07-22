import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";
import { StockTab } from "./tabs/stock";
import { ProductsTab } from "./tabs/products";
import { PricingTab } from "./tabs/pricing";
import { PurchasesTab } from "./tabs/purchases";
import { PurchaseReturnsTab } from "./tabs/purchase-returns";
import { StocktakesTab } from "./tabs/stocktakes";
import { InternalUseTab } from "./tabs/internal-use";
import { getCategoriesWithCounts } from "@/lib/data/categories";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { CategoriesManager } from "../products/categories/categories-manager";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "products", labelKey: "nav.products" },
  { tab: "stock", labelKey: "inventory.title" },
  { tab: "pricing", labelKey: "nav.pricing" },
  { tab: "purchases", labelKey: "nav.purchases" },
  { tab: "purchase-returns", labelKey: "purchaseReturns.title" },
  { tab: "internal", labelKey: "nav.internalUse" },
  { tab: "stocktakes", labelKey: "nav.stocktakes" },
  { tab: "categories", labelKey: "categories.title" },
];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "products";

  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const categoryData = tab === "categories" ? await getCategoriesWithCounts({ page, pageSize }) : null;

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-4 sm:px-6 pt-2.5 flex items-center">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("nav.groups.inventory")} />
        </div>
        <div className="px-4 sm:px-6 pb-1.5"><GroupTabs base={Routes.Inventory} items={TABS} /></div>
      </div>

      {tab === "categories" && categoryData ? <>
        <CategoriesManager categories={categoryData.rows} parentOptions={categoryData.roots} total={categoryData.total} />
        <Pagination page={page} pageCount={categoryData.pageCount} total={categoryData.total} pageSize={pageSize} unitLabel={t("categories.unitLabel")} />
      </>
        : tab === "products" || tab === "camera-materials" ? <ProductsTab searchParams={tab === "camera-materials" ? { ...params, cameraMaterials: "1" } : params} />
        : tab === "pricing" ? <PricingTab searchParams={params} />
        : tab === "purchases" ? <PurchasesTab searchParams={params} />
        : tab === "purchase-returns" ? <PurchaseReturnsTab searchParams={params} />
        : tab === "internal" ? <InternalUseTab searchParams={params} />
        : tab === "stocktakes" ? <StocktakesTab searchParams={params} />
        : <StockTab searchParams={params} />}
    </div>
  );
}
