import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { CashbookTab } from "./tabs/cashbook";
import { EInvoicesTab } from "./tabs/einvoices";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "cashbook", labelKey: "nav.cashbook" },
  { tab: "einvoices", labelKey: "nav.einvoices" },
];

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "cashbook";

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-6 pt-2.5 flex items-center">
          <h1 className="text-[17px] font-bold">{t("nav.groups.finance")}</h1>
        </div>
        <div className="px-6 pb-1.5"><GroupTabs base={Routes.Finance} items={TABS} /></div>
      </div>

      {tab === "einvoices" ? <EInvoicesTab /> : <CashbookTab searchParams={params} />}
    </div>
  );
}
