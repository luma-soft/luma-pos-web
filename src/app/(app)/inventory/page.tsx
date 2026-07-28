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
import { ArrowDownToLine, ClipboardCheck } from "lucide-react";
import Link from "next/link";

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
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-border bg-surface sm:-mx-6 sm:-mt-6 lg:mb-5">
        <div className="flex min-h-[68px] items-center gap-3 px-4 pt-2 sm:px-6 lg:min-h-13 lg:pt-2.5">
          <div className="min-w-0 flex-1">
            <Text as="h1" weight="bold" className="text-xl tracking-[-0.01em] lg:text-[17px]" text={t("nav.groups.inventory")} />
            <Text as="p" variant="muted" className="mt-0.5 text-xs font-semibold lg:hidden" text={t("mobile.inventory.subtitle")} />
          </div>
          <div className="flex items-center gap-1.5 lg:hidden">
            <Link href={`${Routes.Inventory}?tab=purchases`} aria-label={t("nav.purchases")} className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface-2 text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              <ArrowDownToLine className="h-5 w-5" />
            </Link>
            <Link href={`${Routes.Inventory}?tab=stocktakes`} aria-label={t("nav.stocktakes")} className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface-2 text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              <ClipboardCheck className="h-5 w-5" />
            </Link>
          </div>
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
