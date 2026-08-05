import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, Search, Warehouse } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { stocktakeItems, stocktakes, warehouses } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { getInventory, getRecentMovements, type StockFilter } from "@/lib/data/inventory";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { getProductFormOptions } from "@/lib/data/products";
import { Select } from "@/components/ui/select";
import { TableSkeleton } from "@/components/table-skeleton";
import { StockTable } from "./stock-table";
import { InstantFilterForm } from "@/components/instant-filter-form";
import { serializeMovementCreatedAt } from "@/lib/inventory/movement-serialization";
import { RecentMovements } from "./stock-actions";

type SP = Record<string, string | undefined>;
const STOCKS: StockFilter[] = ["all", "instock", "low", "out"];

export async function StockTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const stock: StockFilter = params.low === "1" ? "low" : (STOCKS.includes(params.stock as StockFilter) ? (params.stock as StockFilter) : "all");
  const category = params.category ?? "";
  const { categories } = await getProductFormOptions();

  return (
    <>
      <InstantFilterForm className="flex flex-wrap items-center gap-3 mb-3" action={Routes.Inventory}>
        <input type="hidden" name="tab" value="stock" />
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("inventory.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface focus:border-primary-500 focus:outline-none min-h-11 lg:min-h-0" />
        </div>
        <Select
          name="stock"
          defaultValue={stock}
          options={STOCKS.map((s) => ({ value: s, label: t(`inventory.stockFilter.${s}`) }))}
        />
        <Select
          name="category"
          defaultValue={category}
          options={[{ value: "", label: t("products.list.allCategories") }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          className="min-w-44"
        />
      </InstantFilterForm>

      <Suspense fallback={<TableSkeleton cols={6} rows={10} />}>
        <StockContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function StockContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const stock: StockFilter = params.low === "1" ? "low" : (STOCKS.includes(params.stock as StockFilter) ? (params.stock as StockFilter) : "all");
  const category = params.category ?? "";

  const [{ rows, total, totalValue, lowCount, pageCount }, movements, activeStocktakes] = await Promise.all([
    getInventory({ q: params.q, stock, categoryId: category || undefined, page, pageSize }),
    getRecentMovements(100),
    db.select({
      id: stocktakes.id,
      code: stocktakes.code,
      warehouseName: warehouses.name,
      createdAt: stocktakes.createdAt,
      itemCount: sql<number>`(select count(*) from ${stocktakeItems} where ${stocktakeItems.stocktakeId} = ${stocktakes.id})::int`,
    }).from(stocktakes).innerJoin(warehouses, eq(stocktakes.warehouseId, warehouses.id)).where(eq(stocktakes.status, "draft")).orderBy(desc(stocktakes.createdAt)).limit(1),
  ]);
  const activeStocktake = activeStocktakes[0];
  const movementItems = movements.map((movement) => ({
    ...movement,
    quantity: Number(movement.quantity),
    createdAt: serializeMovementCreatedAt(movement.createdAt),
  }));

  return (
    <>
      {activeStocktake && <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm text-primary-900 dark:border-primary-900 dark:bg-primary-950/40 dark:text-primary-100"><span className="font-bold">{t("inventory.actions.stocktakeInProgress")}</span><span className="text-primary-400">·</span><span>{activeStocktake.warehouseName}</span><span className="text-primary-400">·</span><span>{t("inventory.actions.countedProducts", { count: activeStocktake.itemCount })}</span><a href={`${Routes.Inventory}?tab=stocktakes&q=${encodeURIComponent(activeStocktake.code)}`} className="ml-auto inline-flex items-center gap-1 font-bold text-primary-700 hover:underline dark:text-primary-300">{t("inventory.actions.continue")}<ArrowRight className="h-4 w-4" /></a></div>}

      <div className="mb-4 grid overflow-hidden rounded-card border border-border bg-surface shadow-e1 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("inventory.totalValue")} value={formatCurrency(totalValue)} hint={t("inventory.byCost")} tone="primary" />
        <Metric label={t("inventory.lowStock")} value={formatNumber(lowCount)} hint={t("inventory.belowMin")} tone={lowCount > 0 ? "danger" : "default"} alert={lowCount > 0} />
        <Metric label={t("inventory.skuCount")} value={formatNumber(total)} hint={t("inventory.activeSkus")} />
        <Metric label={t("inventory.recentMoves")} value={formatNumber(movements.length)} hint={t("inventory.actions.loadedMovements")} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {rows.length === 0 ? (
            <div className="rounded-card border border-border bg-surface p-12 text-center text-slate-400 shadow-e1">
              <Warehouse className="mx-auto mb-3 h-10 w-10 opacity-60" />
              <p className="font-medium">{t("inventory.empty")}</p>
            </div>
          ) : (
            <StockTable rows={rows} />
          )}
          <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
        </div>

        <RecentMovements movements={movementItems} />
      </div>
    </>
  );
}

function Metric({ label, value, hint, tone = "default", alert = false }: { label: string; value: string; hint: string; tone?: "default" | "primary" | "danger"; alert?: boolean }) {
  return <div className="border-b border-border p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"><div className="text-xs font-semibold text-slate-500">{label}</div><div className={cn("mt-1.5 font-mono text-xl font-extrabold", tone === "primary" && "text-primary-700", tone === "danger" && "text-er")}>{value}</div><p className="mt-1 flex items-center gap-1 text-xs text-slate-400">{alert && <AlertTriangle className="h-3 w-3 text-er" />}{hint}</p></div>;
}
