import { getTranslations } from "next-intl/server";
import { getInternalUseIssues } from "@/lib/data/internal-use";
import { InternalUseForm } from "../internal-use-form";
import { InternalUseTable } from "./internal-use-table";

export async function InternalUseTab() {
  const t = await getTranslations();
  const rows = await getInternalUseIssues(50);

  return (
    <>
      <InternalUseForm />

      <div className="bg-surface border border-border rounded-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="font-bold text-sm">{t("internalUse.historyTitle")}</div>
          <span className="text-xs text-slate-400">{t("internalUse.historyCount", { n: rows.length })}</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">{t("internalUse.empty")}</p>
        ) : (
          <InternalUseTable rows={rows} />
        )}
      </div>
    </>
  );
}
