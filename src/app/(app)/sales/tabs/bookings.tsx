import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import {
  getOrders,
  type OrderPaymentFilter,
  type OrderStatusFilter,
} from "@/lib/data/orders";
import {
  DEFAULT_ORDER_TIME_PRESET,
  isBookingDeliveryPreset,
  isOrderTimePreset,
  resolveBookingDeliveryPreset,
  resolveOrderTimePreset,
  type BookingDeliveryPreset,
  type OrderTimePreset,
} from "@/lib/orders/filter-date-range";
import { parsePageSize } from "@/lib/pagination";
import { BookingsTable } from "./bookings-table";
import { DocumentFilterDrawer } from "./document-filter-drawer";

type SP = Record<string, string | undefined>;
const BOOKING_STATUSES: OrderStatusFilter[] = ["confirmed", "all", "cancelled"];
const PAYMENT_STATUSES: OrderPaymentFilter[] = ["all", "paid", "partial", "unpaid"];

export async function BookingsTab({ searchParams }: { searchParams: SP }) {
  const status = validValue(searchParams.status, BOOKING_STATUSES, "confirmed");
  const payment = validValue(searchParams.payment, PAYMENT_STATUSES, "all");
  const created = resolveDateFilter(searchParams);
  const delivery = resolveDeliveryFilter(searchParams);

  return (
    <>
      <DocumentFilterDrawer
        key={searchParamsKey(searchParams)}
        kind="bookings"
        values={{
          q: searchParams.q ?? "",
          customerId: searchParams.customerId ?? "",
          customerLabel: searchParams.customerLabel ?? "",
          productId: searchParams.productId ?? "",
          productLabel: searchParams.productLabel ?? "",
          projectId: searchParams.projectId ?? "",
          projectLabel: searchParams.projectLabel ?? "",
          projectQuery: searchParams.projectQuery ?? "",
          timePreset: created.timePreset,
          from: created.from,
          to: created.to,
          deliveryPreset: delivery.deliveryPreset,
          deliveryFrom: delivery.deliveryFrom,
          deliveryTo: delivery.deliveryTo,
          status,
          payment,
          minTotal: searchParams.minTotal ?? "",
          maxTotal: searchParams.maxTotal ?? "",
        }}
      />
      <Suspense fallback={<TableSkeleton cols={6} rows={10} />}>
        <BookingsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function BookingsContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const status = validValue(searchParams.status, BOOKING_STATUSES, "confirmed");
  const payment = validValue(searchParams.payment, PAYMENT_STATUSES, "all");
  const created = resolveDateFilter(searchParams);
  const delivery = resolveDeliveryFilter(searchParams);
  const page = positiveInteger(searchParams.page);
  const pageSize = parsePageSize(searchParams.size);
  const { rows, total, pageCount } = await getOrders({
    documentType: "booking",
    q: searchParams.q,
    customerId: searchParams.customerId,
    productId: searchParams.productId,
    projectId: searchParams.projectId,
    projectQuery: searchParams.projectQuery,
    status,
    payment,
    from: created.from,
    to: created.to,
    deliveryFrom: delivery.deliveryFrom,
    deliveryTo: delivery.deliveryTo,
    minTotal: optionalNumber(searchParams.minTotal),
    maxTotal: optionalNumber(searchParams.maxTotal),
    page,
    pageSize,
  });

  return (
    <>
      <BookingsTable rows={rows} />
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("bookings.title")} />
    </>
  );
}

function resolveDateFilter(params: SP) {
  const timePreset: OrderTimePreset = isOrderTimePreset(params.timePreset)
    ? params.timePreset
    : params.from || params.to
      ? "custom"
      : DEFAULT_ORDER_TIME_PRESET;
  if (timePreset === "custom") {
    return { timePreset, from: params.from ?? "", to: params.to ?? "" };
  }
  return { timePreset, ...(resolveOrderTimePreset(timePreset) ?? { from: "", to: "" }) };
}

function resolveDeliveryFilter(params: SP) {
  const deliveryPreset: BookingDeliveryPreset = isBookingDeliveryPreset(params.deliveryPreset)
    ? params.deliveryPreset
    : params.deliveryFrom || params.deliveryTo
      ? "custom"
      : "all";
  if (deliveryPreset === "custom") {
    return {
      deliveryPreset,
      deliveryFrom: params.deliveryFrom ?? "",
      deliveryTo: params.deliveryTo ?? "",
    };
  }
  const range = resolveBookingDeliveryPreset(deliveryPreset) ?? { from: "", to: "" };
  return { deliveryPreset, deliveryFrom: range.from, deliveryTo: range.to };
}

function validValue<T extends string>(value: string | undefined, values: readonly T[], fallback: T) {
  return values.includes(value as T) ? value as T : fallback;
}

function optionalNumber(value?: string) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function positiveInteger(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function searchParamsKey(params: SP) {
  return Object.entries(params).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value ?? ""}`).join("&");
}
