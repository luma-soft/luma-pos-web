import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, Search, Truck, Warehouse } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { getInventory, getRecentMovements, type StockFilter } from "@/lib/data/inventory";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { getProductFormOptions } from "@/lib/data/products";

interface PageProps {
  searchParams: Promise<{ q?: string; low?: string; stock?: string; category?: string; page?: string; size?: string }>;
}

const STOCKS: StockFilter[] = ["all", "instock", "low", "out"];

const MOVE_STYLES: Record<string, string> = {
  purchase: "text-ok",
  sale: "text-er",
  return_in: "text-in",
  return_out: "text-warn",
  transfer: "text-in",
  adjust: "text-warn",
  init: "text-slate-500",
};

/** Tình trạng tồn theo cột denormalize (không query thêm). */
type Sev = "out" | "crit" | "warn" | "ok";
function stockSev(stock: number, min: number): Sev {
  if (stock <= 0) return "out";
  if (min > 0 && stock <= min) return "crit";
  if (min > 0 && stock <= min * 1.5) return "warn";
  return "ok";
}
const SEV_BAR: Record<Sev, string> = { out: "bg-er", crit: "bg-er", warn: "bg-warn", ok: "bg-primary-500" };

export default async function InventoryPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const stock: StockFilter = params.low === "1"
    ? "low"
    : (STOCKS.includes(params.stock as StockFilter) ? (params.stock as StockFilter) : "all");
  const category = params.category ?? "";

  const [{ rows, total, totalValue, lowCount, pageCount }, movements, { categories }] = await Promise.all([
    getInventory({ q: params.q, stock, categoryId: category || undefined, page, pageSize }),
    getRecentMovements(20),
    getProductFormOptions(),
  ]);

  const kpiCard = "bg-surface border border-border rounded-card shadow-e1 p-4";

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-[17px] font-bold">{t("inventory.title")}</h1>
        <Link href={Routes.PurchaseNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98]">
          <Truck className="w-4 h-4" />
          {t("purchases.createNew")}
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className={kpiCard}>
          <div className="text-xs font-medium text-slate-500">{t("inventory.totalValue")}</div>
          <div className="text-[22px] font-extrabold mt-2 font-mono text-primary-600">{formatCurrency(totalValue)}</div>
          <p className="text-xs text-slate-400 mt-1">{t("inventory.byCost")}</p>
        </div>
        <Link href={`${Routes.Inventory}?stock=low`} className={cn(kpiCard, "hover:border-er/50 transition")}>
          <div className="text-xs font-medium text-slate-500">{t("inventory.lowStock")}</div>
          <div className={cn("text-[28px] font-extrabold mt-2 font-mono", lowCount > 0 ? "text-er" : "text-ok")}>{lowCount}</div>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
            {lowCount > 0 && <AlertTriangle className="w-3 h-3 text-er" />}{t("inventory.belowMin")}
          </p>
        </Link>
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
          <form className="flex flex-wrap items-center gap-3 mb-3" action={Routes.Inventory}>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text" name="q" defaultValue={params.q ?? ""}
                placeholder={t("inventory.searchPlaceholder")}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-[10px] border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <select name="stock" defaultValue={stock} className="px-3 py-2 text-sm rounded-[10px] border border-border bg-surface">
              {STOCKS.map((s) => <option key={s} value={s}>{t(`inventory.stockFilter.${s}`)}</option>)}
            </select>
            <select name="category" defaultValue={category} className="px-3 py-2 text-sm rounded-[10px] border border-border bg-surface">
              <option value="">{t("products.list.allCategories")}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full bg-primary-600 hover:brightness-110 text-white transition active:scale-[0.98]">{t("common.search")}</button>
          </form>

          {/* mobile: card list */}
          {rows.length > 0 && (
            <div className="lg:hidden space-y-2 mb-3">
              {rows.map((r) => {
                const s = Number(r.totalStock);
                const min = Number(r.minLevel);
                const sev = stockSev(s, min);
                return (
                  <Link key={r.id} href={Routes.product(r.id)} className="block bg-surface border border-border rounded-card shadow-e1 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><div className="font-medium truncate">{r.name}</div><div className="text-xs text-slate-400 font-mono">{r.sku}</div></div>
                      <StatusBadge sev={sev} t={t} />
                    </div>
                    <div className="flex items-center justify-between mt-2 text-sm">
                      <span className={cn("font-mono font-semibold", sev === "crit" || sev === "out" ? "text-er" : "text-slate-700 dark:text-slate-300")}>{formatNumber(s)} {r.baseUnit}</span>
                      <span className="text-slate-500 font-mono">{formatCurrency(Number(r.stockValue))}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* desktop: bảng */}
          <div className="hidden lg:block bg-surface border border-border rounded-card shadow-e1 overflow-x-auto">
            {rows.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Warehouse className="w-10 h-10 mx-auto mb-3 opacity-60" />
                <p className="font-medium">{t("inventory.empty")}</p>
              </div>
            ) : (
              <table className="w-full min-w-170 text-sm">
                <thead>
                  <tr className="bg-canvas text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-border">
                    <th className="px-4 py-2.5 font-bold">{t("orders.cols.product")}</th>
                    <th className="px-4 py-2.5 font-bold text-right">{t("inventory.cols.stock")}</th>
                    <th className="px-4 py-2.5 font-bold text-right">{t("inventory.cols.min")}</th>
                    <th className="px-4 py-2.5 font-bold w-28">{t("inventory.cols.level")}</th>
                    <th className="px-4 py-2.5 font-bold text-right">{t("inventory.cols.value")}</th>
                    <th className="px-4 py-2.5 font-bold">{t("orders.cols.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = Number(r.totalStock);
                    const min = Number(r.minLevel);
                    const sev = stockSev(s, min);
                    const pct = min > 0 ? Math.min(100, Math.round((s / (min * 2)) * 100)) : (s > 0 ? 100 : 0);
                    return (
                      <tr key={r.id} className="border-b border-border-soft last:border-0 hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-slate-400 font-mono">{r.sku}</div>
                        </td>
                        <td className={cn("px-4 py-3 text-right font-mono font-bold", (sev === "crit" || sev === "out") && "text-er")}>
                          {formatNumber(s)} <span className="text-[10px] text-slate-400">{r.baseUnit}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-400">{min > 0 ? formatNumber(min) : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="h-1.5 w-20 rounded-full bg-surface-2 overflow-hidden">
                            <div className={cn("h-full rounded-full", SEV_BAR[sev])} style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(r.stockValue))}</td>
                        <td className="px-4 py-3"><StatusBadge sev={sev} t={t} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("products.unitLabel")} />
        </div>

        {/* movements */}
        <div className="bg-surface border border-border rounded-card shadow-e1 overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-border font-bold text-sm">
            {t("inventory.movementsTitle")}
          </div>
          {movements.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-400 text-center">{t("inventory.noMovements")}</p>
          ) : (
            <div className="divide-y divide-border-soft">
              {movements.map((m) => {
                const qty = Number(m.quantity);
                return (
                  <div key={m.id} className="px-4 py-2.5 text-sm flex items-center gap-3">
                    <span className={cn("font-mono font-bold w-24 shrink-0", MOVE_STYLES[m.type] ?? "")}>
                      {qty > 0 ? "+" : ""}{formatNumber(qty)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{m.productName}</div>
                      <div className="text-xs text-slate-400">
                        {t(`inventory.moveTypes.${m.type}` as never)} · {m.warehouseName} · {formatDate(m.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ sev, t }: { sev: Sev; t: Awaited<ReturnType<typeof getTranslations>> }) {
  const map: Record<Sev, { cls: string; key: string }> = {
    out: { cls: "bg-er-soft text-er", key: "inventory.statusOut" },
    crit: { cls: "bg-er-soft text-er", key: "inventory.statusLow" },
    warn: { cls: "bg-warn-soft text-warn", key: "inventory.statusWarn" },
    ok: { cls: "bg-ok-soft text-ok", key: "inventory.statusOk" },
  };
  const m = map[sev];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold", m.cls)}>{t(m.key)}</span>;
}
