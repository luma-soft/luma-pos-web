import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search, ShoppingCart, FileX2 } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { getOrder, getOrders, type OrderStatusFilter, type OrderPaymentFilter } from "@/lib/data/orders";
import { Pagination } from "@/components/pagination";
import { Select } from "@/components/ui/select";
import { parsePageSize } from "@/lib/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { OrderDetailPanel } from "../../orders/[id]/order-detail-panel";
import { OrdersTable } from "./orders-table";

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
    const merged = { tab: "orders", q: params.q, status, payment, from, to, orderId: params.orderId, expandedOrder: params.expandedOrder, page: undefined as string | undefined, ...overrides };
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
        <Link href={Routes.POS} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 hover:brightness-110 text-white text-sm font-medium transition active:scale-[0.98] mb-1.5 shrink-0">
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
        <Select
          name="payment"
          defaultValue={payment}
          aria-label={t("orders.cols.payment")}
          options={PAYMENTS.map((p) => ({ value: p, label: t(`orders.paymentFilter.${p}`) }))}
          className="min-w-32"
        />
        <input type="date" name="from" defaultValue={from} aria-label={t("orders.filter.from")} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        <input type="date" name="to" defaultValue={to} aria-label={t("orders.filter.to")} className="px-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full bg-primary-600 hover:brightness-110 text-white transition active:scale-[0.98]">{t("common.search")}</button>
        {(params.q || payment !== "all" || from || to || params.orderId) && (
          <Link href={href({ q: undefined, payment: undefined, from: undefined, to: undefined, orderId: undefined, expandedOrder: undefined })} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            {t("orders.filter.clear")}
          </Link>
        )}
      </form>

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
  const from = params.from ?? "";
  const to = params.to ?? "";
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);

  const expandedId = params.expandedOrder ?? params.orderId ?? null;
  const { rows, total, pageCount } = await getOrders({ orderId: params.orderId, q: params.q, status, payment, from, to, page, pageSize });
  const expandedOrder = expandedId ? await getOrder(expandedId).catch(() => null) : null;
  const [expandedEinvoice] = expandedOrder
    ? await db.select().from(einvoices).where(eq(einvoices.orderId, expandedOrder.id)).limit(1)
    : [null];

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
          <OrdersTable
            rows={rows}
            expandedId={expandedOrder?.id ?? expandedId}
            expandedContent={expandedOrder ? <OrderDetailPanel order={expandedOrder} einvoice={expandedEinvoice ?? null} compact /> : null}
          />
        </>
      )}

      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("orders.unitLabel")} />
    </>
  );
}
