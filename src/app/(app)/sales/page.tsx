import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";
import { OrdersTab } from "./tabs/orders";
import { QuotesTab } from "./tabs/quotes";
import { BookingsTab } from "./tabs/bookings";
import { EInvoicesTab } from "./tabs/einvoices";
import { ReturnsTab } from "./tabs/returns";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "orders", labelKey: "nav.orders" },
  { tab: "returns", labelKey: "nav.returns" },
  { tab: "quotes", labelKey: "nav.quotes" },
  { tab: "bookings", labelKey: "nav.bookings" },
  { tab: "einvoices", labelKey: "nav.einvoices" },
];

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "orders";

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-border bg-surface sm:-mx-6 sm:-mt-6 lg:mb-5">
        <div className="flex min-h-[68px] items-center px-4 pt-2 sm:px-6 lg:min-h-[52px] lg:pt-2.5">
          <div className="min-w-0">
            <Text as="h1" weight="bold" className="text-xl tracking-[-0.01em] lg:text-[17px]" text={t("nav.groups.sales")} />
            <Text as="p" variant="muted" className="mt-0.5 text-xs font-semibold lg:hidden" text={t("mobile.orders.subtitle")} />
          </div>
        </div>
        <div className="px-4 sm:px-6 pb-1.5"><GroupTabs base={Routes.Sales} items={TABS} /></div>
      </div>

      {tab === "quotes" ? <QuotesTab searchParams={params} />
        : tab === "returns" ? <ReturnsTab searchParams={params} />
        : tab === "bookings" ? <BookingsTab searchParams={params} />
        : tab === "einvoices" ? <EInvoicesTab />
        : <OrdersTab searchParams={params} />}
    </div>
  );
}
