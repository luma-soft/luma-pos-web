import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getStoreSettings } from "@/lib/data/settings";
import { getTables } from "@/lib/data/tables";
import { getModifierGroups } from "@/lib/data/modifiers";
import { getProductFormOptions } from "@/lib/data/products";
import { requireUser, getRole } from "@/lib/actions/common";
import { GroupTabs } from "@/components/group-tabs";
import { TablesFloor } from "./tables-floor";
import { ModifiersManage } from "./modifiers-manage";

export const dynamic = "force-dynamic";

const FNB = new Set(["restaurant", "cafe"]);

export default async function TablesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const store = await getStoreSettings();
  if (!FNB.has(store.industry)) redirect("/dashboard");
  const t = await getTranslations();
  const params = await searchParams;

  let canManage = false;
  try { const r = await getRole((await requireUser()).id); canManage = r === "owner" || r === "manager"; } catch { /* layout */ }

  const tab = canManage && params.tab === "modifiers" ? "modifiers" : "floor";
  const tabs = canManage
    ? [{ tab: "floor", labelKey: "tables.tabs.floor" }, { tab: "modifiers", labelKey: "tables.tabs.modifiers" }]
    : [{ tab: "floor", labelKey: "tables.tabs.floor" }];

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-6 pt-2.5 flex items-center gap-2">
          <h1 className="text-[17px] font-bold">{t("tables.title")}</h1>
        </div>
        {canManage && <div className="px-6 pb-1.5"><GroupTabs base="/tables" items={tabs} /></div>}
      </div>

      {tab === "modifiers"
        ? <ModifiersManage groups={await getModifierGroups()} categories={(await getProductFormOptions()).categories} />
        : <TablesFloor tables={await getTables()} canManage={canManage} />}
    </div>
  );
}
