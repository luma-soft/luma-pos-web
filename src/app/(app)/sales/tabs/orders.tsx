import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search, ShoppingCart, FileX2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { getOrders, type OrderStatusFilter, type OrderPaymentFilter } from "@/lib/data/orders";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { OrderStatusBadge, PaymentStatusBadge } from "../../orders/status-badges";
import { TableSkeleton } from "@/components/table-skeleton";

type SP = Record<string, string | undefined>;

const STATUS: OrderStatusFilter[] = ["all", "completed", "owing", "returned", "cancelled"];
const PAYMENTS: OrderPaymentFilter[] = ["all", "paid", "partial", "unpaid"];

export async function OrdersTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const status = (STATUS.includes(params.status as OrderStatusFilter) ? params.status : "all") as OrderStatusFilter;
  const payment = (PAYMENTS.includes(params.payment as OrderPaymentFilter) ? params.payment : "all") as OrderPaymentFilter;
  const from = params.from ?? "";
  const to = params.to ?? "";

  const href = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { tab: "orders", q: params.q, status, payment, from, to, page: undefined as string | undefined, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") sp.set(k, v);
    return `${Routes.Sales}?${sp.toString()}`;
  };

  return (
    <>
      <div className="flex items-end justify-between gap-3 border-b border-border mb-4">
        <div className="flex gap-1">
          {STATUS.map((tab) => (
            <Link
              key={tab}
              href={href({ status: tab, page: undefined })}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
                status === tab ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              {t(`orders.tabs.${tab}`)}
            </Link>
          ))}
        </div>
        <Link href={Routes.POS} target="_blank" className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98] mb-1.5 shrink-0">
          <ShoppingCart className="w-4 h-4" />
          {t("orders.createViaPos")}
        </Link>
      </div>

      <form className="flex flex-wrap items-center gap-2 mb-4" action={Routes.Sales}>
        <input type="hidden" name="tab" value="orders" />
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("orders.searchPlaceholder")} aria-label={t("common.search")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <select name="payment" defaultValue={payment} aria-label={t("orders.cols.payment")} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
          {PAYMENTS.map((p) => <option key={p} value={p}>{t(`orders.paymentFilter.${p}`)}</option>)}
        </select>
        <input type="date" name="from" defaultValue={from} aria-label={t("orders.filter.from")} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        <input type="date" name="to" defaultValue={to} aria-label={t("orders.filter.to")} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full bg-primary-600 hover:brightness-110 text-white transition active:scale-[0.98]">{t("common.search")}</button>
        {(params.q || payment !== "all" || from || to) && (
          <Link href={href({ q: undefined, payment: undefined, from: undefined, to: undefined })} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            {t("orders.filter.clear")}
          </Link>
        )}
      </form>

      <Suspense fallback={<TableSkeleton cols={9} rows={10} />}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OrdersContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const status = (STATUS.includes(params.status as OrderStatusFilter) ? params.status : "all") as OrderStatusFilter;
  const payment = (PAYMENTS.includes(params.payment as OrderPaymentFilter) ? params.payment : "all") as OrderPaymentFilter;
  const from = params.from ?? "";
  const to = params.to ?? "";
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const { rows, total, pageCount } = await getOrders({ q: params.q, status, payment, from, to, page, pageSize });

  return (
    <>
      <div className="mb-2">
        <span className="text-sm text-slate-500">{t("orders.total", { total })}</span>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <FileX2 className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("orders.empty")}</p>
        </div>
      ) : (
        <>
          <div className="lg:hidden space-y-2">
            {rows.map((o) => {
              const remaining = Number(o.total) - Number(o.amountPaid);
              return (
                <Link key={o.id} href={Routes.order(o.id)} className={cn("block bg-surface border border-border rounded-card p-3", o.status === "cancelled" && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-primary-600">{o.code}</div>
                      <div className="text-xs text-slate-400">{formatDate(o.createdAt)} · {o.customerName ?? t("orders.walkIn")}</div>
                    </div>
                    <OrderStatusBadge status={o.status} />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-sm">
                    <span className="font-semibold tabular-nums">{formatCurrency(Number(o.total))}</span>
                    {remaining > 0 && o.status !== "cancelled"
                      ? <span className="text-er font-semibold tabular-nums">{t("orders.cols.remaining")}: {formatCurrency(remaining)}</span>
                      : <PaymentStatusBadge status={o.paymentStatus} />}
                  </div>
                </Link>
              );
            })}
          </div>

          <form action="/orders/print-batch" className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
            <div className="px-4 py-2 border-b border-border flex items-center gap-3 text-sm">
              <span className="text-xs text-slate-500">{t("orders.batchHint")}</span>
              <div className="flex-1" />
              <button type="submit" formAction="/orders/merge" className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-surface-2">🔗 {t("merge.title")}</button>
              <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-surface-2">🖨 {t("orders.printSelected")}</button>
            </div>
            <table className="w-full min-w-170 text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.code")}</th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.date")}</th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.customer")}</th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.project")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.total")}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.remaining")}</th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.payment")}</th>
                  <th className="px-4 py-3 font-semibold">{t("orders.cols.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {rows.map((o) => {
                  const remaining = Number(o.total) - Number(o.amountPaid);
                  return (
                    <tr key={o.id} className={cn("hover:bg-surface-2", o.status === "cancelled" && "opacity-60")}>
                      <td className="px-4 py-3"><input type="checkbox" name="ids" value={o.id} disabled={o.status === "cancelled"} /></td>
                      <td className="px-4 py-3"><Link href={Routes.order(o.id)} className="font-medium text-primary-600 hover:underline">{o.code}</Link></td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(o.createdAt)}</td>
                      <td className="px-4 py-3">{o.customerName ?? t("orders.walkIn")}</td>
                      <td className="px-4 py-3 text-slate-500">{o.projectName ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(Number(o.total))}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", remaining > 0 && o.status !== "cancelled" ? "text-er font-semibold" : "text-slate-400")}>
                        {remaining > 0 && o.status !== "cancelled" ? formatCurrency(remaining) : "—"}
                      </td>
                      <td className="px-4 py-3"><PaymentStatusBadge status={o.paymentStatus} /></td>
                      <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </form>
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("orders.unitLabel")} />
    </>
  );
}
