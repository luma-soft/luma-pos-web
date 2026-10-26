import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { and, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { ClipboardCheck, Plus, Search } from "lucide-react";
import { db } from "@/db";
import { profiles, stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { StocktakesTable } from "./stocktakes-table";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { requireStoreContext } from "@/lib/auth/store-context";
import { parsePageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import { stocktakeListSummaryFields } from "@/lib/stocktakes/list-summary-fields";

type SP = Record<string, string | undefined>;

export async function StocktakesTab({ searchParams }: { searchParams: SP }) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const q = searchParams.stocktakeQ?.trim();
  const searchCondition = q
    ? or(
      ilike(stocktakes.code, `%${q}%`),
      ilike(stocktakes.note, `%${q}%`),
      ilike(warehouses.name, `%${q}%`),
      ilike(profiles.fullName, `%${q}%`),
    )
    : undefined;
  const where = and(
    eq(stocktakes.storeId, context.storeId),
    ne(stocktakes.status, "cancelled"),
    searchCondition,
  );
  const canViewValues = canViewPurchasePrices(context.role);
  const pageSize = parsePageSize(searchParams.size);
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.page) || 1));

  const [countResult] = await db
    .select({ total: count() })
    .from(stocktakes)
    .innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(stocktakes.createdBy, profiles.id))
    .where(where);
  const total = countResult?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);

  const rows = await db
    .select({
      id: stocktakes.id, code: stocktakes.code, status: stocktakes.status, note: stocktakes.note,
      createdAt: stocktakes.createdAt, balancedAt: stocktakes.balancedAt, warehouseName: warehouses.name, byName: profiles.fullName,
      itemCount: sql<number>`(select count(*) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id})::int`,
      totalDiff: sql<string>`coalesce((select sum(${stocktakeItems.actualQty} - ${stocktakeItems.systemQty}) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id}), 0)`,
      ...stocktakeListSummaryFields(context.storeId, canViewValues),
    })
    .from(stocktakes)
    .innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id))
    .leftJoin(profiles, eq(stocktakes.createdBy, profiles.id))
    .where(where)
    .orderBy(desc(stocktakes.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return (
    <section className="space-y-4" aria-labelledby="stocktake-list-heading">
      <h2 id="stocktake-list-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">
        {t("stocktakes.listTitle")}
      </h2>
      <InstantFilterForm
        className="flex flex-wrap items-center gap-3"
        action={Routes.Inventory}
      >
        <input type="hidden" name="tab" value="stock" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            name="stocktakeQ"
            defaultValue={searchParams.stocktakeQ ?? ""}
            placeholder="Theo mã phiếu kiểm"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm min-h-11 lg:min-h-0"
          />
        </div>
        <Link href={Routes.StocktakeNew} className="ml-auto inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
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
        <StocktakesTable
          rows={rows}
          fillHeight={false}
          canCancelBalanced={canViewValues}
          canViewValues={canViewValues}
        />
      )}
      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        pageSize={pageSize}
        unitLabel={t("stocktakes.unitLabel")}
      />
      <p className="text-xs text-slate-400">{t("stocktakes.balanceHint")}</p>
    </section>
  );
}
