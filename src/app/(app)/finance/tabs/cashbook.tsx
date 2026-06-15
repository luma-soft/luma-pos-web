import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { getCashbook } from "@/lib/data/cashbook";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { CashTxForm } from "../../cashbook/cash-tx-form";

type SP = Record<string, string | undefined>;

const CAT_STYLES: Record<string, string> = {
  sale: "bg-ok-soft text-ok", debt_collect: "bg-ok-soft text-ok", supplier_payment: "bg-er-soft text-er",
  refund: "bg-warn-soft text-warn", expense: "bg-warn-soft text-warn", other: "bg-surface-2 text-slate-600",
};

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
      <div className="flex justify-end mb-4"><CashTxForm /></div>

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

      <div className="flex gap-1.5 mb-4">
        {(["", "in", "out"] as const).map((tp) => (
          <Link key={tp || "all"} href={href({ type: tp || undefined, page: undefined })} className={cn("px-3 py-1.5 rounded-lg text-sm font-medium border", (params.type ?? "") === tp ? "bg-primary-600 text-white border-primary-600" : "border-border text-slate-600 dark:text-slate-300")}>
            {t(`cashbook.typeTabs.${tp || "all"}`)}
          </Link>
        ))}
      </div>

      {data.rows.length === 0 ? (
        <div className="bg-surface border border-border rounded-card"><p className="p-10 text-center text-slate-400 text-sm">{t("cashbook.empty")}</p></div>
      ) : (
        <>
          <div className="lg:hidden space-y-2">
            {data.rows.map((r) => (
              <div key={r.id} className="bg-surface border border-border rounded-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-medium">{r.code}</div><div className="text-xs text-slate-500 mt-0.5">{formatDate(r.createdAt)} · {r.fund === "cash" ? t("cashbook.fundCash") : t("cashbook.fundBank")}</div></div>
                  <span className={cn("tabular-nums font-semibold whitespace-nowrap", r.type === "in" ? "text-ok" : "text-er")}>{r.type === "in" ? "+" : "−"} {formatCurrency(Number(r.amount))}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", CAT_STYLES[r.category] ?? CAT_STYLES.other)}>{t(`cashbook.categories.${r.category}` as never)}</span>
                  <span className="text-xs text-slate-500 truncate">{r.refType === "order" && r.refId ? <Link href={Routes.order(r.refId)} className="text-primary-600 hover:underline">{r.note}</Link> : r.note ?? ""}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
            <table className="w-full min-w-170 text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 font-semibold">{t("cashbook.cols.code")}</th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.date")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cashbook.cols.category")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cashbook.cols.note")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cashbook.cols.fund")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("cashbook.cols.amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3 font-medium">{r.code}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3"><span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", CAT_STYLES[r.category] ?? CAT_STYLES.other)}>{t(`cashbook.categories.${r.category}` as never)}</span></td>
                    <td className="px-4 py-3 text-slate-500">{r.refType === "order" && r.refId ? <Link href={Routes.order(r.refId)} className="text-primary-600 hover:underline">{r.note}</Link> : r.note ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.fund === "cash" ? t("cashbook.fundCash") : t("cashbook.fundBank")}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", r.type === "in" ? "text-ok" : "text-er")}>{r.type === "in" ? "+" : "−"} {formatCurrency(Number(r.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination page={page} pageCount={data.pageCount} total={data.total} pageSize={pageSize} unitLabel={t("cashbook.unitLabel")} />
    </>
  );
}
