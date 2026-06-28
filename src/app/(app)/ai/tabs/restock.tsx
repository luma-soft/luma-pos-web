import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRestockSuggestions, type RestockPriority } from "@/lib/data/ai-restock";
import { RestockTable } from "./restock-table";

export async function RestockTab() {
  const t = await getTranslations();
  const rows = await getRestockSuggestions(30);
  const counts = { high: 0, medium: 0, low: 0 } as Record<RestockPriority, number>;
  rows.forEach((r) => { counts[r.priority]++; });

  return (
    <>
      <div className="flex items-start gap-2 mb-4 text-xs text-slate-500">
        <Sparkles className="w-4 h-4 text-primary-600 shrink-0 mt-px" />
        <span>{t("ai.restockHint")}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5 max-w-md">
        {(["high", "medium", "low"] as RestockPriority[]).map((p) => (
          <div key={p} className="bg-surface border border-border rounded-card shadow-e1 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t(`ai.priority.${p}`)}</div>
            <div className={cn("text-2xl font-extrabold font-mono mt-1", p === "high" ? "text-er" : p === "medium" ? "text-warn" : "text-ok")}>{counts[p]}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("ai.restockEmpty")}</p>
        </div>
      ) : (
        <RestockTable rows={rows} />
      )}
    </>
  );
}
