import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import { getCashbook } from "@/lib/data/cashbook";
import { Pagination } from "@/components/pagination";
import { DesktopPagination } from "@/components/mobile-load-more";
import { loadCashbookPage } from "./load-more-actions";
import { parsePageSize } from "@/lib/pagination";
import { CashTxForm } from "../../cashbook/cash-tx-form";
import { CashbookTable } from "./cashbook-table";
import { Banknote, Landmark, ArrowDownLeft, ArrowUpRight } from "lucide-react";

/** NativeCashbook compact money: 3.8Bđ, 6.1Mđ, 350Kđ, 0đ. */
function compact(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}Bđ`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}Mđ`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}Kđ`;
  return `${sign}${Math.round(abs)}đ`;
}
import { requireStoreContext } from "@/lib/auth/store-context";

type SP = Record<string, string | undefined>;

export async function CashbookTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const context = await requireStoreContext();
  const data = await getCashbook(context.storeId, { fund: params.fund, type: params.type, page, pageSize });

  const href = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string | undefined> = { tab: "cashbook", fund: params.fund, type: params.type, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    return `${Routes.Finance}?${sp.toString()}`;
  };

  const fundCycle = params.fund === "cash" ? "bank" : params.fund === "bank" ? undefined : "cash";
  const chip = (active: boolean) => cn(
    "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[17px]",
    active ? "bg-ios-accent text-white" : "text-ios-label",
  );
  return (
    <>
      {/* Phones: CashbookView — fund balance tiles, filter chips, create button, transactions. */}
      <div className="space-y-4 pb-2 lg:hidden">
        <h3 className="text-[17px] text-ios-label-secondary">{t("mobile.finance.balances")}</h3>
        <div className="grid grid-cols-2 gap-2.5">
          {([["cash", Banknote, data.cash], ["bank", Landmark, data.bank]] as const).map(([fund, Icon, fundData]) => (
            <Link key={fund} href={href({ fund: params.fund === fund ? undefined : fund, page: undefined })}
              className={cn("block rounded-[18px] border bg-surface p-3.5", params.fund === fund ? "border-ios-accent" : "border-border")}>
              <span className="flex items-center gap-2 text-[15px] text-ios-accent"><Icon className="size-5" aria-hidden="true" />{t(fund === "cash" ? "mobile.finance.cash" : "mobile.finance.bank")}</span>
              <span className="mt-2 block truncate text-[20px] font-bold tabular-nums">{formatCurrency(fundData.balance)}</span>
              <span className="mt-1.5 block truncate text-[12px] tabular-nums text-ios-label-secondary">+{compact(fundData.in)} · −{compact(fundData.out)}</span>
            </Link>
          ))}
        </div>
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]">
          <Link href={href({ type: undefined, page: undefined })} className={chip(!params.type)}>{t("mobile.finance.all")}</Link>
          <Link href={href({ type: "in", page: undefined })} className={chip(params.type === "in")}><ArrowDownLeft className="size-4" aria-hidden="true" />{t("mobile.finance.in")}</Link>
          <Link href={href({ type: "out", page: undefined })} className={chip(params.type === "out")}><ArrowUpRight className="size-4" aria-hidden="true" />{t("mobile.finance.out")}</Link>
          <Link href={href({ fund: fundCycle, page: undefined })} className={chip(Boolean(params.fund))}>
            {params.fund === "bank" ? <Landmark className="size-4" aria-hidden="true" /> : <Banknote className="size-4" aria-hidden="true" />}
            {t(params.fund === "bank" ? "mobile.finance.bank" : "mobile.finance.cash")}
          </Link>
        </div>
        <CashTxForm />
        <h3 className="pt-1 text-[17px] text-ios-label-secondary">{t("mobile.finance.transactions")}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5 max-lg:hidden">
        <Link href={href({ fund: params.fund === "cash" ? undefined : "cash", page: undefined })} className={cn("block bg-surface border rounded-card p-4 min-h-11 min-w-11", params.fund === "cash" ? "border-primary-600" : "border-border")}>
          <div className="text-xs font-medium text-slate-500">💵 {t("cashbook.fundCash")}</div>
          <div className="text-xl font-bold mt-1 tabular-nums">{formatCurrency(data.cash.balance)}</div>
          <div className="text-xs text-slate-400 mt-0.5"><span className="text-ok">+{formatCurrency(data.cash.in)}</span> · <span className="text-er">−{formatCurrency(data.cash.out)}</span></div>
        </Link>
        <Link href={href({ fund: params.fund === "bank" ? undefined : "bank", page: undefined })} className={cn("block bg-surface border rounded-card p-4 min-h-11 min-w-11", params.fund === "bank" ? "border-primary-600" : "border-border")}>
          <div className="text-xs font-medium text-slate-500">🏦 {t("cashbook.fundBank")}</div>
          <div className="text-xl font-bold mt-1 tabular-nums">{formatCurrency(data.bank.balance)}</div>
          <div className="text-xs text-slate-400 mt-0.5"><span className="text-ok">+{formatCurrency(data.bank.in)}</span> · <span className="text-er">−{formatCurrency(data.bank.out)}</span></div>
        </Link>
        <div className="bg-surface border border-border rounded-card p-4">
          <div className="text-xs font-medium text-slate-500">{t("cashbook.totalBalance")}</div>
          <div className="text-xl font-bold mt-1 tabular-nums">{formatCurrency(data.cash.balance + data.bank.balance)}</div>
          <div className="text-xs text-slate-400 mt-0.5">{t("cashbook.autoHint")}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-4 max-lg:hidden">
        {(["", "in", "out"] as const).map((tp) => (
          <Link key={tp || "all"} href={href({ type: tp || undefined, page: undefined })} className={cn("inline-flex min-h-11 min-w-11 items-center justify-center px-3 py-1.5 rounded-lg text-sm font-medium border lg:min-h-0 lg:min-w-0", (params.type ?? "") === tp ? "bg-primary-600 text-white border-primary-600" : "border-border text-slate-600 dark:text-slate-300")}>
            {t(`cashbook.typeTabs.${tp || "all"}`)}
          </Link>
        ))}
        <div className="ml-auto"><CashTxForm /></div>
      </div>

      {data.rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-card"><p className="p-10 text-center text-slate-400 text-sm">{t("cashbook.empty")}</p></div>
      ) : (
        <CashbookTable rows={data.rows} loadMore={{ page, pageCount: data.pageCount, loadPage: loadCashbookPage.bind(null, params) }} />
      )}

      <DesktopPagination>
        <Pagination page={page} pageCount={data.pageCount} total={data.total} pageSize={pageSize} unitLabel={t("cashbook.unitLabel")} />
      </DesktopPagination>
    </>
  );
}
