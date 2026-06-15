import { getTranslations } from "next-intl/server";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { getInternalUseIssues } from "@/lib/data/internal-use";
import { InternalUseForm } from "../internal-use-form";

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-150">
              <thead>
                <tr className="bg-canvas text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-border">
                  <th className="px-4 py-2.5 font-bold">{t("internalUse.cols.code")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("orders.cols.date")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("internalUse.department")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("internalUse.reason")}</th>
                  <th className="px-4 py-2.5 font-bold text-right">{t("internalUse.cols.items")}</th>
                  <th className="px-4 py-2.5 font-bold text-right">{t("internalUse.cols.cost")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("internalUse.cols.by")}</th>
                  <th className="px-4 py-2.5 font-bold">{t("orders.cols.status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border-soft last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3 font-mono font-medium text-primary-600">{r.code}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3">{r.department ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.reason ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.itemCount}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-warn">{formatCurrency(Number(r.totalCost))}</td>
                    <td className="px-4 py-3 text-slate-500">{r.createdByName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold", r.status === "pending" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
                        {r.status === "pending" ? t("internalUse.status.pending") : t("internalUse.status.approved")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
