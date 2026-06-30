import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";
import { OrdersTab } from "./tabs/orders";
import { QuotesTab } from "./tabs/quotes";
import { BookingsTab } from "./tabs/bookings";
import { PromotionsTab } from "./tabs/promotions";
import { EInvoicesTab } from "./tabs/einvoices";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "orders", labelKey: "nav.orders" },
  { tab: "quotes", labelKey: "nav.quotes" },
  { tab: "bookings", labelKey: "nav.bookings" },
  { tab: "einvoices", labelKey: "nav.einvoices" },
  { tab: "promotions", labelKey: "nav.promotions" },
];

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "orders";

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-[52px] px-4 sm:px-6 pt-2.5 flex items-center">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("nav.groups.sales")} />
        </div>
        <div className="px-4 sm:px-6 pb-1.5"><GroupTabs base={Routes.Sales} items={TABS} /></div>
      </div>

      {tab === "quotes" ? <QuotesTab searchParams={params} />
        : tab === "bookings" ? <BookingsTab searchParams={params} />
        : tab === "einvoices" ? <EInvoicesTab />
        : tab === "promotions" ? <PromotionsTab />
        : <OrdersTab searchParams={params} />}
    </div>
  );
}
