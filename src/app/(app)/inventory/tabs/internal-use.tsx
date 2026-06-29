import { getTranslations } from "next-intl/server";
import { getInternalUseIssues } from "@/lib/data/internal-use";
import { InternalUseForm } from "../internal-use-form";
import { InternalUseTable } from "./internal-use-table";
import { Plus } from "lucide-react";

export async function InternalUseTab() {
  const t = await getTranslations();
  const rows = await getInternalUseIssues(50);

  return (
    <div className="space-y-4">
      <details id="internal-use-create" className="group rounded-card border border-border bg-surface shadow-e1">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition hover:bg-surface-2 sm:px-5">
          <span className="flex items-center gap-2 text-sm font-bold text-primary-700">
            <Plus className="h-4 w-4" />
            {t("internalUse.formTitle")}
          </span>
          <span className="text-xs text-slate-400 group-open:hidden">{t("internalUse.formSub")}</span>
        </summary>
        <div className="border-t border-border p-3 sm:p-4">
          <InternalUseForm />
        </div>
      </details>

      <InternalUseTable rows={rows} />
    </div>
  );
}
