import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { MergeConfirm } from "./merge-confirm";

interface Props {
  searchParams: Promise<{ ids?: string | string[] }>;
}

export default async function MergeOrdersPage({ searchParams }: Props) {
  const params = await searchParams;
  const t = await getTranslations();
  const ids = (Array.isArray(params.ids) ? params.ids : params.ids ? [params.ids] : []).slice(0, 20);

  const rows = ids.length
    ? await db
        .select({
          id: orders.id,
          code: orders.code,
          status: orders.status,
          total: orders.total,
          amountPaid: orders.amountPaid,
          createdAt: orders.createdAt,
          customerId: orders.customerId,
          customerName: customers.name,
        })
        .from(orders)
        .leftJoin(customers, eq(orders.customerId, customers.id))
        .where(inArray(orders.id, ids))
    : [];

  const eligible = rows.filter((o) => o.status === "completed" && o.customerId);
  const customerIds = new Set(eligible.map((o) => o.customerId));
  const sameCustomer = customerIds.size === 1;
  const canMerge = eligible.length >= 2 && sameCustomer && eligible.length === rows.length;

  const total = eligible.reduce((s, o) => s + Number(o.total), 0);
  const paid = eligible.reduce((s, o) => s + Number(o.amountPaid), 0);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-5">{t("merge.title")}</h1>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-10 text-center text-slate-400">
          <p>{t("merge.noneSelected")}</p>
          <Link href={Routes.Orders} className="text-primary-600 hover:underline text-sm mt-2 inline-block">← {t("orders.title")}</Link>
        </div>
      ) : (
        <>
          <div className="bg-surface border border-border rounded-card overflow-hidden mb-4">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border-soft">
                {rows.map((o) => {
                  const bad = o.status !== "completed" || !o.customerId;
                  return (
                    <tr key={o.id} className={cn(bad && "bg-red-50 dark:bg-red-950/30")}>
                      <td className="px-4 py-3 font-medium">{o.code}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(o.createdAt)}</td>
                      <td className="px-4 py-3">{o.customerName ?? t("orders.walkIn")}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(Number(o.total))}</td>
                      <td className="px-4 py-3 text-xs">
                        {bad
                          ? <span className="text-er font-medium">{!o.customerId ? t("merge.errNoCustomer") : t("merge.errStatus")}</span>
                          : <span className="text-ok">✓</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-surface border border-border rounded-card p-5">
            {!sameCustomer && rows.length > 1 && (
              <p className="text-sm text-er mb-3">{t("merge.errors.sameCustomer")}</p>
            )}
            <div className="flex items-end justify-between flex-wrap gap-4">
              <div className="text-sm space-y-1">
                <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("merge.totalMerged", { count: eligible.length })}</span><b className="tabular-nums">{formatCurrency(total)}</b></div>
                <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("print.paid")}</span><span className="tabular-nums text-ok">{formatCurrency(paid)}</span></div>
                <div className="flex gap-6 justify-between"><span className="text-slate-500">{t("orders.detail.remaining")}</span><span className="tabular-nums font-semibold text-er">{formatCurrency(Math.max(0, total - paid))}</span></div>
              </div>
              <MergeConfirm ids={eligible.map((o) => o.id)} disabled={!canMerge} />
            </div>
            <p className="text-xs text-slate-400 mt-3">{t("merge.hint")}</p>
          </div>
        </>
      )}
    </div>
  );
}
