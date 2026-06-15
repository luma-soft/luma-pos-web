import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search, ShoppingCart, FileX2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { getOrders, type OrderStatusFilter, type OrderPaymentFilter } from "@/lib/data/orders";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { OrderStatusBadge, PaymentStatusBadge } from "./status-badges";

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; payment?: string; from?: string; to?: string; page?: string; size?: string }>;
}

const TABS: OrderStatusFilter[] = ["all", "completed", "owing", "returned", "cancelled"];
const PAYMENTS: OrderPaymentFilter[] = ["all", "paid", "partial", "unpaid"];

export default async function OrdersPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const status = (TABS.includes(params.status as OrderStatusFilter) ? params.status : "all") as OrderStatusFilter;
  const payment = (PAYMENTS.includes(params.payment as OrderPaymentFilter) ? params.payment : "all") as OrderPaymentFilter;
  const from = params.from ?? "";
  const to = params.to ?? "";
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const { rows, total, pageCount } = await getOrders({ q: params.q, status, payment, from, to, page, pageSize });

  const href = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { q: params.q, status, payment, from, to, page: undefined as string | undefined, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") sp.set(k, v);
    const s = sp.toString();
    return `${Routes.Orders}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-bold">{t("orders.title")}</h1>
          <span className="text-sm text-slate-500">{t("orders.total", { total })}</span>
        </div>
        <Link
          href={Routes.POS} target="_blank"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
        >
          <ShoppingCart className="w-4 h-4" />
          {t("orders.createViaPos")}
        </Link>
      </div>

      <div className="flex gap-1 border-b border-border mb-4">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={href({ status: tab, page: undefined })}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
              status === tab
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            )}
          >
            {t(`orders.tabs.${tab}`)}
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3 mb-4" action={Routes.Orders}>
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t("common.search")}</label>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text" name="q" defaultValue={params.q ?? ""}
              placeholder={t("orders.searchPlaceholder")}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t("orders.cols.payment")}</label>
          <select name="payment" defaultValue={payment} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface">
            {PAYMENTS.map((p) => <option key={p} value={p}>{t(`orders.paymentFilter.${p}`)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t("orders.filter.from")}</label>
          <input type="date" name="from" defaultValue={from} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t("orders.filter.to")}</label>
          <input type="date" name="to" defaultValue={to} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white">
          {t("common.search")}
        </button>
        {(params.q || payment !== "all" || from || to) && (
          <Link href={href({ q: undefined, payment: undefined, from: undefined, to: undefined })} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            {t("orders.filter.clear")}
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <FileX2 className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("orders.empty")}</p>
        </div>
      ) : (
        <>
        {/* mobile: card list */}
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

        {/* desktop: bảng + chọn in hàng loạt */}
        <form action="/orders/print-batch" className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
          <div className="px-4 py-2 border-b border-border flex items-center gap-3 text-sm">
            <span className="text-xs text-slate-500">{t("orders.batchHint")}</span>
            <div className="flex-1" />
            <button
              type="submit"
              formAction="/orders/merge"
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-surface-2"
            >
              🔗 {t("merge.title")}
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-surface-2"
            >
              🖨 {t("orders.printSelected")}
            </button>
          </div>
          <table className="w-full min-w-[640px] text-sm">
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
                    <td className="px-4 py-3">
                      <input type="checkbox" name="ids" value={o.id} disabled={o.status === "cancelled"} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={Routes.order(o.id)} className="font-medium text-primary-600 hover:underline">{o.code}</Link>
                    </td>
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
    </div>
  );
}
