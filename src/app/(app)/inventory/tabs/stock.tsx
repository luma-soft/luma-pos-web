import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, Search, Truck, Warehouse } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { getInventory, getRecentMovements, type StockFilter } from "@/lib/data/inventory";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { getProductFormOptions } from "@/lib/data/products";
import { TableSkeleton } from "@/components/table-skeleton";
import { StockTable } from "./stock-table";

type SP = Record<string, string | undefined>;
const STOCKS: StockFilter[] = ["all", "instock", "low", "out"];

const MOVE_STYLES: Record<string, string> = {
  purchase: "text-ok", sale: "text-er", return_in: "text-in", return_out: "text-warn",
  transfer: "text-in", adjust: "text-warn", init: "text-slate-500", internal_use: "text-warn",
};

export async function StockTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const stock: StockFilter = params.low === "1" ? "low" : (STOCKS.includes(params.stock as StockFilter) ? (params.stock as StockFilter) : "all");
  const category = params.category ?? "";
  const { categories } = await getProductFormOptions();

  return (
    <>
      <form className="flex flex-wrap items-center gap-3 mb-3" action={Routes.Inventory}>
        <input type="hidden" name="tab" value="stock" />
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("inventory.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <select name="stock" defaultValue={stock} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          {STOCKS.map((s) => <option key={s} value={s}>{t(`inventory.stockFilter.${s}`)}</option>)}
        </select>
        <select name="category" defaultValue={category} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          <option value="">{t("products.list.allCategories")}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full bg-primary-600 hover:brightness-110 text-white transition active:scale-[0.98]">{t("common.search")}</button>
        <Link href={Routes.PurchaseNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98] ml-auto shrink-0">
          <Truck className="w-4 h-4" />{t("purchases.createNew")}
        </Link>
      </form>

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

  const [{ rows, total, totalValue, lowCount, pageCount }, movements] = await Promise.all([
    getInventory({ q: params.q, stock, categoryId: category || undefined, page, pageSize }),
    getRecentMovements(20),
  ]);

  const kpiCard = "bg-surface border border-border rounded-card shadow-e1 p-4";

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className={kpiCard}>
          <div className="text-xs font-medium text-slate-500">{t("inventory.totalValue")}</div>
          <div className="text-[22px] font-extrabold mt-2 font-mono text-primary-600">{formatCurrency(totalValue)}</div>
          <p className="text-xs text-slate-400 mt-1">{t("inventory.byCost")}</p>
        </div>
        <div className={cn(kpiCard, lowCount > 0 && "border-er/40 bg-er/5")}>
          <div className="text-xs font-medium text-slate-500">{t("inventory.lowStock")}</div>
          <div className={cn("text-[28px] font-extrabold mt-2 font-mono", lowCount > 0 ? "text-er" : "text-ok")}>{lowCount}</div>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">{lowCount > 0 && <AlertTriangle className="w-3 h-3 text-er" />}{t("inventory.belowMin")}</p>
        </div>
        <div className={kpiCard}>
          <div className="text-xs font-medium text-slate-500">{t("inventory.skuCount")}</div>
          <div className="text-[28px] font-extrabold mt-2 font-mono">{formatNumber(total)}</div>
          <p className="text-xs text-slate-400 mt-1">{t("inventory.activeSkus")}</p>
        </div>
        <div className={kpiCard}>
          <div className="text-xs font-medium text-slate-500">{t("inventory.recentMoves")}</div>
          <div className="text-[28px] font-extrabold mt-2 font-mono">{movements.length}</div>
          <p className="text-xs text-slate-400 mt-1">{t("inventory.last20")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
        <div>
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

        <div className="bg-surface border border-border rounded-card shadow-e1 overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-border font-bold text-sm">{t("inventory.movementsTitle")}</div>
          {movements.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-400 text-center">{t("inventory.noMovements")}</p>
          ) : (
            <div className="divide-y divide-border-soft">
              {movements.map((m) => {
                const qty = Number(m.quantity);
                return (
                  <div key={m.id} className="px-4 py-2.5 text-sm flex items-center gap-3">
                    <span className={cn("font-mono font-bold w-24 shrink-0", MOVE_STYLES[m.type] ?? "")}>{qty > 0 ? "+" : ""}{formatNumber(qty)}</span>
                    <div className="min-w-0 flex-1"><div className="font-medium truncate">{m.productName}</div><div className="text-xs text-slate-400">{t(`inventory.moveTypes.${m.type}` as never)} · {m.warehouseName} · {formatDate(m.createdAt)}</div></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
