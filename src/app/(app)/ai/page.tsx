import { getTranslations } from "next-intl/server";
import { GroupTabs } from "@/components/group-tabs";
import { RestockTab } from "./tabs/restock";
import { Assistant } from "./assistant";

export const dynamic = "force-dynamic";

const TABS = [
  { tab: "restock", labelKey: "ai.restockTab" },
  { tab: "assistant", labelKey: "ai.assistantTab" },
];

export default async function AiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const tab = params.tab ?? "restock";

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 bg-surface border-b border-border">
        <div className="min-h-13 px-6 pt-2.5 flex items-center gap-2">
          <h1 className="text-[17px] font-bold">{t("nav.ai")}</h1>
        </div>
        <div className="px-6 pb-1.5"><GroupTabs base="/ai" items={TABS} /></div>
      </div>

      {tab === "assistant" ? <Assistant /> : <RestockTab />}
    </div>
  );
}
