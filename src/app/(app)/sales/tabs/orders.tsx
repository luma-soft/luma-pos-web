import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search, ShoppingCart, FileX2, SlidersHorizontal } from "lucide-react";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { getOrders, type OrderStatusFilter, type OrderPaymentFilter, type OrderSourceFilter } from "@/lib/data/orders";
import { Pagination } from "@/components/pagination";
import { Select } from "@/components/ui/select";
import { parsePageSize } from "@/lib/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { OrdersTable } from "./orders-table";
import { InstantFilterForm } from "@/components/instant-filter-form";

type SP = Record<string, string | undefined>;

const STATUS: OrderStatusFilter[] = ["all", "completed", "owing", "returned", "cancelled"];
const PAYMENTS: OrderPaymentFilter[] = ["all", "paid", "partial", "unpaid"];
const SOURCES: OrderSourceFilter[] = ["all", "pos", "shopee", "tiktok_shop", "lazada", "tiki"];

export async function OrdersTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const status = (STATUS.includes(params.status as OrderStatusFilter) ? params.status : "all") as OrderStatusFilter;
  const payment = (PAYMENTS.includes(params.payment as OrderPaymentFilter) ? params.payment : "all") as OrderPaymentFilter;
  const source = (SOURCES.includes(params.source as OrderSourceFilter) ? params.source : "all") as OrderSourceFilter;
  const from = params.from ?? "";
  const to = params.to ?? "";

  const href = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { tab: "orders", q: params.q, status, payment, source, from, to, orderId: params.orderId, page: undefined as string | undefined, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") sp.set(k, v);
    return `${Routes.Sales}?${sp.toString()}`;
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 border-b border-border sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div className="-mx-4 flex snap-x snap-mandatory gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
          {STATUS.map((tab) => (
            <Link
              key={tab}
              href={href({ status: tab, page: undefined })}
              className={cn(
                "min-h-11 shrink-0 snap-start border-b-2 px-4 py-2 text-sm font-medium sm:min-h-0",
                status === tab ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              {t(`orders.tabs.${tab}`)}
            </Link>
          ))}
        </div>
        <Link href={Routes.POS} className="mb-2 inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] sm:mb-1.5 sm:min-h-0 sm:w-auto">
          <ShoppingCart className="w-4 h-4" />
          {t("orders.createViaPos")}
        </Link>
      </div>

      <InstantFilterForm className="mb-4 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap" action={Routes.Sales}>
        <input type="hidden" name="tab" value="orders" />
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <div className="relative col-span-2 w-full sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("orders.searchPlaceholder")} aria-label={t("common.search")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <details className="group col-span-2 lg:contents">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-bold text-slate-600 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:hidden">
            <SlidersHorizontal className="h-4 w-4" />
            {t("mobile.orders.filters")}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 lg:contents">
            <Select
              name="payment"
              defaultValue={payment}
              aria-label={t("orders.cols.payment")}
              options={PAYMENTS.map((p) => ({ value: p, label: t(`orders.paymentFilter.${p}`) }))}
              className="w-full min-w-0 sm:w-auto sm:min-w-32"
            />
            <Select
              name="source"
              defaultValue={source}
              aria-label={t("orders.cols.channel")}
              options={[
                { value: "all", label: t("orders.sourceFilter.all") },
                { value: "pos", label: "POS" },
                { value: "shopee", label: "Shopee" },
                { value: "tiktok_shop", label: "TikTok Shop" },
                { value: "lazada", label: "Lazada" },
                { value: "tiki", label: "Tiki" },
              ]}
              className="w-full min-w-0 sm:w-auto sm:min-w-36"
            />
            <input type="date" name="from" defaultValue={from} aria-label={t("orders.filter.from")} className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            <input type="date" name="to" defaultValue={to} aria-label={t("orders.filter.to")} className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            {(params.q || payment !== "all" || source !== "all" || from || to || params.orderId) && (
              <Link href={href({ q: undefined, payment: undefined, source: undefined, from: undefined, to: undefined, orderId: undefined })} className="col-span-2 px-3 py-2 text-center text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 sm:col-span-1">
                {t("orders.filter.clear")}
              </Link>
            )}
          </div>
        </details>
      </InstantFilterForm>

      <Suspense fallback={<TableSkeleton cols={10} rows={10} />}>
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
  const source = (SOURCES.includes(params.source as OrderSourceFilter) ? params.source : "all") as OrderSourceFilter;
  const from = params.from ?? "";
  const to = params.to ?? "";
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const { rows, total, pageCount } = await getOrders({ orderId: params.orderId, q: params.q, status, payment, source, from, to, page, pageSize });

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
          <OrdersTable rows={rows} />
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("orders.unitLabel")} />
    </>
  );
}
