import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import { getCashbook } from "@/lib/data/cashbook";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { CashTxForm } from "../../cashbook/cash-tx-form";
import { CashbookTable } from "./cashbook-table";

type SP = Record<string, string | undefined>;

export async function CashbookTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const data = await getCashbook({ fund: params.fund, type: params.type, page, pageSize });

  const href = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string | undefined> = { tab: "cashbook", fund: params.fund, type: params.type, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    return `${Routes.Finance}?${sp.toString()}`;
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Link href={href({ fund: params.fund === "cash" ? undefined : "cash", page: undefined })} className={cn("bg-surface border rounded-card p-4", params.fund === "cash" ? "border-primary-600" : "border-border")}>
          <div className="text-xs font-medium text-slate-500">💵 {t("cashbook.fundCash")}</div>
          <div className="text-xl font-bold mt-1 tabular-nums">{formatCurrency(data.cash.balance)}</div>
          <div className="text-xs text-slate-400 mt-0.5"><span className="text-ok">+{formatCurrency(data.cash.in)}</span> · <span className="text-er">−{formatCurrency(data.cash.out)}</span></div>
        </Link>
        <Link href={href({ fund: params.fund === "bank" ? undefined : "bank", page: undefined })} className={cn("bg-surface border rounded-card p-4", params.fund === "bank" ? "border-primary-600" : "border-border")}>
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

      <div className="flex items-center gap-1.5 mb-4">
        {(["", "in", "out"] as const).map((tp) => (
          <Link key={tp || "all"} href={href({ type: tp || undefined, page: undefined })} className={cn("px-3 py-1.5 rounded-lg text-sm font-medium border", (params.type ?? "") === tp ? "bg-primary-600 text-white border-primary-600" : "border-border text-slate-600 dark:text-slate-300")}>
            {t(`cashbook.typeTabs.${tp || "all"}`)}
          </Link>
        ))}
        <div className="ml-auto"><CashTxForm /></div>
      </div>

      {data.rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-card"><p className="p-10 text-center text-slate-400 text-sm">{t("cashbook.empty")}</p></div>
      ) : (
        <CashbookTable rows={data.rows} />
      )}

      <Pagination page={page} pageCount={data.pageCount} total={data.total} pageSize={pageSize} unitLabel={t("cashbook.unitLabel")} />
    </>
  );
}
