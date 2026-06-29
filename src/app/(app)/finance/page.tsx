import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";
import { CashbookTab } from "./tabs/cashbook";
import { ShiftsTab } from "./tabs/shifts";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "cashbook", labelKey: "nav.cashbook" },
  { tab: "shifts", labelKey: "nav.shifts" },
];

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "cashbook";

  if (tab === "einvoices") {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) usp.set(key, value);
    usp.set("tab", "einvoices");
    redirect(`${Routes.Sales}?${usp.toString()}`);
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-4 sm:px-6 pt-2.5 flex items-center">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("nav.groups.finance")} />
        </div>
        <div className="px-4 sm:px-6 pb-1.5"><GroupTabs base={Routes.Finance} items={TABS} /></div>
      </div>

      {tab === "shifts" ? <ShiftsTab /> : <CashbookTab searchParams={params} />}
    </div>
  );
}
