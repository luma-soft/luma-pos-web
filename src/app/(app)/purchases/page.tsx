import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Truck, Search } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { getPurchases } from "@/lib/data/inventory";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; page?: string; size?: string }>;
}

const PSTATUS = ["", "received", "returned", "cancelled"] as const;

export default async function PurchasesPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const status = PSTATUS.includes(params.status as typeof PSTATUS[number]) ? (params.status ?? "") : "";
  const { rows, total, pageCount } = await getPurchases({ q: params.q, status: status || undefined, page, pageSize });

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-bold">{t("purchases.title")}</h1>
          <span className="text-sm text-slate-500">{t("purchases.total", { total })}</span>
        </div>
        <Link href={Routes.PurchaseNew} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">
          <Plus className="w-4 h-4" />
          {t("purchases.createNew")}
        </Link>
      </div>

      <form className="flex flex-wrap items-center gap-3 mb-4" action={Routes.Purchases}>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("purchases.searchPlaceholder")}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <select name="status" defaultValue={status} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          <option value="">{t("orders.tabs.all")}</option>
          <option value="received">{t("purchases.status.received")}</option>
          <option value="returned">{t("purchases.status.returned")}</option>
          <option value="cancelled">{t("purchases.status.cancelled")}</option>
        </select>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white">{t("common.search")}</button>
      </form>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("purchases.empty")}</p>
          <p className="text-sm mt-1">{t("purchases.emptyHint")}</p>
        </div>
      ) : (
        <>
        {/* mobile: card list */}
        <div className="lg:hidden space-y-2">
          {rows.map((p) => {
            const owed = Number(p.total) - Number(p.amountPaid);
            return (
              <Link key={p.id} href={`${Routes.Purchases}/${p.id}/print`} className="block bg-surface border border-border rounded-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-semibold">{p.code}</div><div className="text-xs text-slate-400">{formatDate(p.createdAt)} · {p.supplierName}</div></div>
                  <span className={cn("shrink-0 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                    p.status === "returned" ? "bg-warn-soft text-warn"
                    : p.status === "cancelled" ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400"
                    : "bg-ok-soft text-ok")}>{t(`purchases.status.${p.status}` as never)}</span>
                </div>
                <div className="flex items-center justify-between mt-2 text-sm">
                  <span className="font-semibold tabular-nums">{formatCurrency(Number(p.total))}</span>
                  {owed > 0 && <span className="text-warn font-semibold tabular-nums">{t("purchases.cols.owed")}: {formatCurrency(owed)}</span>}
                </div>
              </Link>
            );
          })}
        </div>

        {/* desktop: bảng */}
        <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-semibold">{t("purchases.cols.code")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.date")}</th>
                <th className="px-4 py-3 font-semibold">{t("purchases.cols.supplier")}</th>
                <th className="px-4 py-3 font-semibold">{t("purchases.cols.warehouse")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.total")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("purchases.cols.owed")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.status")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {rows.map((p) => {
                const owed = Number(p.total) - Number(p.amountPaid);
                return (
                  <tr key={p.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3 font-medium">{p.code}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                    <td className="px-4 py-3">{p.supplierName}</td>
                    <td className="px-4 py-3 text-slate-500">{p.warehouseName}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(Number(p.total))}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", owed > 0 ? "text-warn font-semibold" : "text-slate-400")}>
                      {owed > 0 ? formatCurrency(owed) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        p.status === "returned"
                          ? "bg-warn-soft text-warn"
                          : p.status === "cancelled"
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400"
                            : "bg-ok-soft text-ok"
                      )}>
                        {t(`purchases.status.${p.status}` as never)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`${Routes.Purchases}/${p.id}/print`} className="text-xs font-medium text-primary-600 hover:underline">
                        🖨 {t("print.printBtn")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("purchases.unitLabel")} />
    </div>
  );
}
