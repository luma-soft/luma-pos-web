import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Sparkles, Truck } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatNumber } from "@/lib/utils";
import { getRestockSuggestions, type RestockPriority } from "@/lib/data/ai-restock";

const PILL: Record<RestockPriority, string> = {
  high: "bg-er-soft text-er", medium: "bg-warn-soft text-warn", low: "bg-ok-soft text-ok",
};

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
        <div className="bg-surface border border-border rounded-card shadow-e1 overflow-x-auto">
          <table className="w-full min-w-170 text-sm">
            <thead>
              <tr className="bg-canvas text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-border">
                <th className="px-4 py-2.5 font-bold">{t("orders.cols.product")}</th>
                <th className="px-4 py-2.5 font-bold text-right">{t("ai.cols.onHand")}</th>
                <th className="px-4 py-2.5 font-bold text-right">{t("ai.cols.velocity")}</th>
                <th className="px-4 py-2.5 font-bold text-right">{t("ai.cols.daysLeft")}</th>
                <th className="px-4 py-2.5 font-bold text-right">{t("ai.cols.suggested")}</th>
                <th className="px-4 py-2.5 font-bold">{t("ai.cols.priority")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-soft last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3"><div className="font-medium">{r.name}</div><div className="text-xs text-slate-400 font-mono">{r.sku}</div></td>
                  <td className="px-4 py-3 text-right font-mono">{formatNumber(r.stock)} <span className="text-[10px] text-slate-400">{r.baseUnit}</span></td>
                  <td className="px-4 py-3 text-right font-mono">{r.velocity.toFixed(1)}<span className="text-[10px] text-slate-400">/{t("ai.perDay")}</span></td>
                  <td className={cn("px-4 py-3 text-right font-mono font-bold", r.daysOfStock != null && r.daysOfStock < 7 ? "text-er" : r.daysOfStock != null && r.daysOfStock < 14 ? "text-warn" : "text-slate-500")}>
                    {r.daysOfStock != null ? `${r.daysOfStock.toFixed(1)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-primary-600">{r.suggestedQty > 0 ? `+${formatNumber(r.suggestedQty)}` : "—"}</td>
                  <td className="px-4 py-3"><span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold", PILL[r.priority])}>{t(`ai.priority.${r.priority}`)}</span></td>
                  <td className="px-4 py-3 text-right">
                    {r.suggestedQty > 0 && <Link href={Routes.PurchaseNew} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"><Truck className="w-3.5 h-3.5" />{t("ai.createPo")}</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
