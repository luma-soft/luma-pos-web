import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { desc, eq, sql } from "drizzle-orm";
import { ClipboardCheck, Plus } from "lucide-react";
import { db } from "@/db";
import { profiles, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { StocktakesTable } from "./stocktakes-table";

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
        <StocktakesTable rows={rows} />
      )}
      <p className="text-xs text-slate-400 mt-3">{t("stocktakes.balanceHint")}</p>
    </>
  );
}
