import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { ClipboardCheck, Plus, Search } from "lucide-react";
import { db } from "@/db";
import { profiles, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { StocktakesTable } from "./stocktakes-table";
import { InstantFilterForm } from "@/components/instant-filter-form";

type SP = Record<string, string | undefined>;

export async function StocktakesTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const q = searchParams.q?.trim();
  const searchCondition = q
    ? or(
      ilike(stocktakes.code, `%${q}%`),
      ilike(stocktakes.note, `%${q}%`),
      ilike(warehouses.name, `%${q}%`),
      ilike(profiles.fullName, `%${q}%`),
    )
    : undefined;

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
    .where(searchCondition)
    .orderBy(desc(stocktakes.createdAt)).limit(50);

  return (
    <>
      <InstantFilterForm className="mb-4 flex flex-wrap items-center gap-3" action={Routes.Inventory}>
        <input type="hidden" name="tab" value="stocktakes" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="Theo mã phiếu kiểm"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <Link href={Routes.StocktakeNew} className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
          <Plus className="h-4 w-4" />
          {t("stocktakes.createNew")}
        </Link>
      </InstantFilterForm>

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
