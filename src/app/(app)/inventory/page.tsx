import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { StockTab } from "./tabs/stock";
import { ProductsTab } from "./tabs/products";
import { PricingTab } from "./tabs/pricing";
import { PurchasesTab } from "./tabs/purchases";
import { StocktakesTab } from "./tabs/stocktakes";
import { InternalUseTab } from "./tabs/internal-use";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "stock", labelKey: "inventory.title" },
  { tab: "products", labelKey: "nav.products" },
  { tab: "pricing", labelKey: "nav.pricing" },
  { tab: "purchases", labelKey: "nav.purchases" },
  { tab: "internal", labelKey: "nav.internalUse" },
  { tab: "stocktakes", labelKey: "nav.stocktakes" },
];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "stock";

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-6 pt-2.5 flex items-center">
          <h1 className="text-[17px] font-bold">{t("nav.groups.inventory")}</h1>
        </div>
        <div className="px-6 pb-1.5"><GroupTabs base={Routes.Inventory} items={TABS} /></div>
      </div>

      {tab === "products" ? <ProductsTab searchParams={params} />
        : tab === "pricing" ? <PricingTab searchParams={params} />
        : tab === "purchases" ? <PurchasesTab searchParams={params} />
        : tab === "internal" ? <InternalUseTab />
        : tab === "stocktakes" ? <StocktakesTab />
        : <StockTab searchParams={params} />}
    </div>
  );
}
