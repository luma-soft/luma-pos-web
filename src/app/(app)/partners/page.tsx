import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";
import { CustomersTab } from "./tabs/customers";
import { SuppliersTab } from "./tabs/suppliers";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "customers", labelKey: "nav.customers" },
  { tab: "suppliers", labelKey: "nav.suppliers" },
];

export default async function PartnersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "customers";
  if (tab === "projects") redirect(`${Routes.Services}?tab=projects`);

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-4 sm:px-6 pt-2.5 flex items-center">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("nav.groups.partners")} />
        </div>
        <div className="px-4 sm:px-6 pb-1.5"><GroupTabs base={Routes.Partners} items={TABS} /></div>
      </div>

      {tab === "suppliers" ? <SuppliersTab searchParams={params} /> : <CustomersTab searchParams={params} />}
    </div>
  );
}
