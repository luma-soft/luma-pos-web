import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShoppingCart, FileX2 } from "lucide-react";
import { Routes } from "@/lib/routes";
import {
  getOrders,
  type OrderStatusFilter,
  type OrderPaymentFilter,
  type OrderPaymentMethodFilter,
  type OrderSourceFilter,
} from "@/lib/data/orders";
import { Pagination } from "@/components/pagination";
import { parsePageSize } from "@/lib/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { OrdersTable } from "./orders-table";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { OrdersFilterDrawer } from "./orders-filter-drawer";

type SP = Record<string, string | undefined>;

const STATUS: OrderStatusFilter[] = [
  "all",
  "completed",
  "owing",
  "returned",
  "cancelled",
];
const PAYMENTS: OrderPaymentFilter[] = ["all", "paid", "partial", "unpaid"];
const PAYMENT_METHODS: OrderPaymentMethodFilter[] = [
  "all",
  "cash",
  "bank_transfer",
  "card",
];
const SOURCES: OrderSourceFilter[] = [
  "all",
  "pos",
  "shopee",
  "tiktok_shop",
  "lazada",
  "tiki",
];

export async function OrdersTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const status = (
    STATUS.includes(params.status as OrderStatusFilter) ? params.status : "all"
  ) as OrderStatusFilter;
  const payment = (
    PAYMENTS.includes(params.payment as OrderPaymentFilter)
      ? params.payment
      : "all"
  ) as OrderPaymentFilter;
  const paymentMethod = (
    PAYMENT_METHODS.includes(params.paymentMethod as OrderPaymentMethodFilter)
      ? params.paymentMethod
      : "all"
  ) as OrderPaymentMethodFilter;
  const source = (
    SOURCES.includes(params.source as OrderSourceFilter) ? params.source : "all"
  ) as OrderSourceFilter;
  const from = params.from ?? "";
  const to = params.to ?? "";
  const includeCancelled = params.includeCancelled === "1";

  return (
    <>
      <div className="mb-4 flex justify-end border-b border-border pb-3">
        <Link
          href={Routes.POS}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] lg:min-h-0"
        >
          <ShoppingCart className="w-4 h-4" />
          {t("orders.createViaPos")}
        </Link>
      </div>

      <OrdersFilterDrawer
        values={{
          q: params.q ?? "",
          customerQuery: params.customerQuery ?? "",
          productQuery: params.productQuery ?? "",
          status,
          payment,
          paymentMethod,
          source,
          from,
          to,
          minTotal: params.minTotal ?? "",
          maxTotal: params.maxTotal ?? "",
          includeCancelled,
        }}
      />

      <Suspense fallback={<TableSkeleton cols={10} rows={10} />}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OrdersContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const status = (
    STATUS.includes(params.status as OrderStatusFilter) ? params.status : "all"
  ) as OrderStatusFilter;
  const payment = (
    PAYMENTS.includes(params.payment as OrderPaymentFilter)
      ? params.payment
      : "all"
  ) as OrderPaymentFilter;
  const paymentMethod = (
    PAYMENT_METHODS.includes(params.paymentMethod as OrderPaymentMethodFilter)
      ? params.paymentMethod
      : "all"
  ) as OrderPaymentMethodFilter;
  const source = (
    SOURCES.includes(params.source as OrderSourceFilter) ? params.source : "all"
  ) as OrderSourceFilter;
  const from = params.from ?? "";
  const to = params.to ?? "";
  const page = Number(params.page) || 1;
  const pageSize = parsePageSize(params.size);
  const includeCancelled = params.includeCancelled === "1";
  const minTotal = optionalNumber(params.minTotal);
  const maxTotal = optionalNumber(params.maxTotal);

  const [{ rows, total, pageCount }, printTemplates] = await Promise.all([
    getOrders({
      orderId: params.orderId,
      q: params.q,
      customerQuery: params.customerQuery,
      productQuery: params.productQuery,
      status,
      payment,
      paymentMethod,
      source,
      from,
      to,
      minTotal,
      maxTotal,
      includeCancelled,
      page,
      pageSize,
    }),
    getPrintTemplatesForDoc("order"),
  ]);

  return (
    <>
      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <FileX2 className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("orders.empty")}</p>
        </div>
      ) : (
        <>
          <OrdersTable rows={rows} printTemplates={printTemplates} />
        </>
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        pageSize={pageSize}
        unitLabel={t("orders.unitLabel")}
      />
    </>
  );
}

function optionalNumber(value?: string) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
