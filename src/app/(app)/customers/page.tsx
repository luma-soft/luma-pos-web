import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search, UserPlus, Users } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import { getCustomers } from "@/lib/data/partners";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { CustomerTypeBadge } from "./type-badge";

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string; owing?: string; page?: string; size?: string }>;
}

const TYPE_TABS = ["all", "retail", "wholesale", "contractor", "agent", "owing"] as const;

export default async function CustomersPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const activeTab = params.owing === "1" ? "owing" : (params.type ?? "all");

  const { rows, total, pageCount, totalDebt } = await getCustomers({
    q: params.q,
    type: activeTab !== "all" && activeTab !== "owing" ? activeTab : undefined,
    owing: activeTab === "owing",
    page,
    pageSize,
  });

  const href = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string | undefined> = { q: params.q, type: params.type, owing: params.owing, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return `${Routes.Customers}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-bold">{t("customers.title")}</h1>
          <span className="text-sm text-slate-500">{t("customers.total", { total })}</span>
          <span className="text-sm text-slate-500">·</span>
          <span className="text-sm text-warn font-medium">{t("customers.totalDebt", { debt: formatCurrency(totalDebt) })}</span>
        </div>
        <Link
          href={Routes.CustomerNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
        >
          <UserPlus className="w-4 h-4" />
          {t("customers.createNew")}
        </Link>
      </div>

      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto">
        {TYPE_TABS.map((tab) => (
          <Link
            key={tab}
            href={href({
              type: tab === "all" || tab === "owing" ? undefined : tab,
              owing: tab === "owing" ? "1" : undefined,
              page: undefined,
            })}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap",
              activeTab === tab
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
              tab === "owing" && activeTab !== "owing" && "text-red-500"
            )}
          >
            {t(`customers.tabs.${tab}`)}
          </Link>
        ))}
      </div>

      <form className="flex items-center gap-3 mb-4" action={Routes.Customers}>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text" name="q" defaultValue={params.q ?? ""}
            placeholder={t("customers.searchPlaceholder")}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface"
          />
        </div>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg border border-border bg-surface hover:bg-surface-2">
          {t("common.search")}
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("customers.empty")}</p>
        </div>
      ) : (
        <>
        {/* mobile: card list */}
        <div className="lg:hidden space-y-2">
          {rows.map((c) => {
            const debt = Number(c.currentDebt);
            return (
              <Link key={c.id} href={Routes.customer(c.id)} className="block bg-surface border border-border rounded-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-slate-400">{c.phone ?? c.code}</div>
                  </div>
                  <CustomerTypeBadge type={c.type} />
                </div>
                <div className="flex items-center justify-between mt-2 text-sm">
                  <span className="text-slate-500">{t("customers.cols.totalSpent")}: <span className="tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(Number(c.totalSpent))}</span></span>
                  {debt > 0 && <span className="text-er font-semibold tabular-nums">{t("customers.cols.debt")}: {formatCurrency(debt)}</span>}
                </div>
              </Link>
            );
          })}
        </div>

        {/* desktop: bảng */}
        <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-semibold">{t("customers.cols.name")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.cols.phone")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.cols.type")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("customers.cols.totalSpent")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("customers.cols.debt")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("customers.cols.debtLimit")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {rows.map((c) => {
                const debt = Number(c.currentDebt);
                const limit = Number(c.debtLimit ?? 0);
                return (
                  <tr key={c.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={Routes.customer(c.id)} className="font-medium text-primary-600 hover:underline">{c.name}</Link>
                      <div className="text-xs text-slate-400">{c.code}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{c.phone ?? "—"}</td>
                    <td className="px-4 py-3"><CustomerTypeBadge type={c.type} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(Number(c.totalSpent))}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", debt > 0 ? "text-er" : "text-slate-400")}>
                      {debt > 0 ? formatCurrency(debt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                      {limit > 0 ? formatCurrency(limit) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("customers.unitLabel")} />
    </div>
  );
}
