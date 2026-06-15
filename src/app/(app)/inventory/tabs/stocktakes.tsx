import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { desc, eq, sql } from "drizzle-orm";
import { ClipboardCheck, Plus } from "lucide-react";
import { db } from "@/db";
import { profiles, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { StocktakeRowActions } from "../../stocktakes/stocktake-actions";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-warn-soft text-warn", balanced: "bg-ok-soft text-ok", cancelled: "bg-surface-2 text-slate-500",
};

export async function StocktakesTab() {
  const t = await getTranslations();
  const rows = await db
    .select({
      id: stocktakes.id, code: stocktakes.code, status: stocktakes.status, note: stocktakes.note,
      createdAt: stocktakes.createdAt, balancedAt: stocktakes.balancedAt, warehouseName: warehouses.name, byName: profiles.fullName,
      itemCount: sql<number>`(select count(*) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id})::int`,
      totalDiff: sql<string>`coalesce((select sum(${stocktakeItems.actualQty} - ${stocktakeItems.systemQty}) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id}), 0)`,
    })
    .from(stocktakes)
    .innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(stocktakes.createdBy, profiles.id))
    .orderBy(desc(stocktakes.createdAt)).limit(50);

  return (
    <>
      <div className="flex items-center justify-end gap-3 flex-wrap mb-4">
        <Link href={Routes.StocktakeNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98]"><Plus className="w-4 h-4" />{t("stocktakes.createNew")}</Link>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("stocktakes.empty")}</p>
          <p className="text-sm mt-1">{t("stocktakes.emptyHint")}</p>
        </div>
      ) : (
        <>
          <div className="lg:hidden space-y-2">
            {rows.map((r) => {
              const diff = Number(r.totalDiff);
              return (
                <div key={r.id} className={cn("bg-surface border border-border rounded-card p-3", r.status === "cancelled" && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="font-medium">{r.code}</div><div className="text-xs text-slate-400">{formatDate(r.createdAt)} · {r.warehouseName}</div></div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLES[r.status])}>{t(`stocktakes.status.${r.status}` as never)}</span>
                      <StocktakeRowActions id={r.id} status={r.status} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-sm">
                    <span className="text-slate-500">{r.itemCount} {t("stocktakes.cols.items")}</span>
                    <span className={cn("tabular-nums font-semibold", diff > 0 ? "text-ok" : diff < 0 ? "text-er" : "text-slate-400")}>{diff > 0 ? "+" : ""}{formatNumber(diff)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
            <table className="w-full min-w-170 text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 font-semibold">{t("stocktakes.cols.code")}</th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.date")}</th>
                  <th className="px-4 py-3 font-semibold">{t("purchases.cols.warehouse")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("stocktakes.cols.items")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("stocktakes.cols.totalDiff")}</th>
                  <th className="px-4 py-3 font-semibold">{t("stocktakes.cols.balancedAt")}</th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.status")}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.map((r) => {
                  const diff = Number(r.totalDiff);
                  return (
                    <tr key={r.id} className={cn("hover:bg-surface-2", r.status === "cancelled" && "opacity-60")}>
                      <td className="px-4 py-3"><div className="font-medium">{r.code}</div>{r.byName && <div className="text-xs text-slate-400">{r.byName}</div>}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3">{r.warehouseName}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.itemCount}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", diff > 0 ? "text-ok" : diff < 0 ? "text-er" : "text-slate-400")}>{diff > 0 ? "+" : ""}{formatNumber(diff)}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.balancedAt ? formatDate(r.balancedAt) : "—"}</td>
                      <td className="px-4 py-3"><span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLES[r.status])}>{t(`stocktakes.status.${r.status}` as never)}</span></td>
                      <td className="px-4 py-3 text-right"><StocktakeRowActions id={r.id} status={r.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-xs text-slate-400 mt-3">{t("stocktakes.balanceHint")}</p>
    </>
  );
}
