import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search, Truck } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import { getSuppliers } from "@/lib/data/partners";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { SupplierQuickCreate } from "../../suppliers/supplier-form";

type SP = Record<string, string | undefined>;
const OWING = ["", "owing", "clear"] as const;
type Owing = (typeof OWING)[number];

export async function SuppliersTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const owing: Owing = OWING.includes(params.owing as Owing) ? (params.owing as Owing) : "";
  const { rows, total, pageCount } = await getSuppliers({ q: params.q, owing: owing === "" ? undefined : owing, page, pageSize });

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <span className="text-sm text-slate-500">{t("suppliers.total", { total })}</span>
        <SupplierQuickCreate />
      </div>

      <form className="flex items-center gap-3 mb-4" action={Routes.Partners}>
        <input type="hidden" name="tab" value="suppliers" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("suppliers.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <select name="owing" defaultValue={owing} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          <option value="">{t("suppliers.filter.allDebt")}</option>
          <option value="owing">{t("suppliers.filter.owing")}</option>
          <option value="clear">{t("suppliers.filter.clear")}</option>
        </select>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full border border-border bg-surface hover:bg-surface-2">{t("common.search")}</button>
      </form>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Truck className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("suppliers.empty")}</p>
        </div>
      ) : (
        <>
          <div className="lg:hidden space-y-2">
            {rows.map((s) => {
              const debt = Number(s.currentDebt);
              return (
                <Link key={s.id} href={Routes.supplier(s.id)} className="flex items-center justify-between gap-2 bg-surface border border-border rounded-card p-3">
                  <div className="min-w-0"><div className="font-medium truncate">{s.name}</div><div className="text-xs text-slate-400">{s.phone ?? s.code}</div></div>
                  {debt > 0 ? <span className="shrink-0 text-warn font-semibold tabular-nums text-sm">{formatCurrency(debt)}</span> : <span className="text-slate-300">—</span>}
                </Link>
              );
            })}
          </div>

          <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
            <table className="w-full min-w-170 text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 font-semibold">{t("suppliers.cols.name")}</th>
                  <th className="px-4 py-3 font-semibold">{t("customers.cols.phone")}</th>
                  <th className="px-4 py-3 font-semibold">{t("customers.fields.taxCode")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("suppliers.cols.debt")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.map((s) => {
                  const debt = Number(s.currentDebt);
                  return (
                    <tr key={s.id} className="hover:bg-surface-2">
                      <td className="px-4 py-3"><Link href={Routes.supplier(s.id)} className="font-medium text-primary-600 hover:underline">{s.name}</Link><div className="text-xs text-slate-400">{s.code}</div></td>
                      <td className="px-4 py-3 text-slate-500">{s.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{s.taxCode ?? "—"}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", debt > 0 ? "text-warn" : "text-slate-400")}>{debt > 0 ? formatCurrency(debt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("suppliers.unitLabel")} />
    </>
  );
}
