import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import { getReturn, getReturns } from "@/lib/data/returns";
import {
  DEFAULT_ORDER_TIME_PRESET,
  isOrderTimePreset,
  resolveOrderTimePreset,
  type OrderTimePreset,
} from "@/lib/orders/filter-date-range";
import { parsePageSize } from "@/lib/pagination";
import {
  returnReasons,
  returnRefundMethods,
  type ReturnReasonFilter,
} from "@/lib/returns/list-filter-schema";
import { DocumentFilterDrawer } from "./document-filter-drawer";
import { ReturnDetailFooter, ReturnDetailPanel } from "./return-detail-panel";
import { ReturnsTable } from "./returns-table";

type SP = Record<string, string | undefined>;
type RefundMethod = (typeof returnRefundMethods)[number];

export async function ReturnsTab({ searchParams }: { searchParams: SP }) {
  const reason = validValue(searchParams.reason, returnReasons, "all");
  const refundMethod = validValue(searchParams.refundMethod, returnRefundMethods, "all");
  const { timePreset, from, to } = resolveDateFilter(searchParams);

  return (
    <>
      <DocumentFilterDrawer
        key={searchParamsKey(searchParams)}
        kind="returns"
        values={{
          q: searchParams.q ?? "",
          customerId: searchParams.customerId ?? "",
          customerLabel: searchParams.customerLabel ?? "",
          productId: searchParams.productId ?? "",
          productLabel: searchParams.productLabel ?? "",
          orderId: searchParams.orderId ?? "",
          orderLabel: searchParams.orderLabel ?? "",
          warehouseId: searchParams.warehouseId ?? "",
          warehouseLabel: searchParams.warehouseLabel ?? "",
          timePreset,
          from,
          to,
          reason,
          refundMethod,
          minTotal: searchParams.minTotal ?? "",
          maxTotal: searchParams.maxTotal ?? "",
          includeCancelled: searchParams.includeCancelled === "1",
        }}
      />
      <Suspense fallback={<TableSkeleton cols={8} rows={10} />}>
        <ReturnsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ReturnsContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const page = positiveInteger(searchParams.page);
  const pageSize = parsePageSize(searchParams.size);
  const expandedId = searchParams.expandedReturn ?? null;
  const reason: ReturnReasonFilter = validValue(searchParams.reason, returnReasons, "all");
  const refundMethod: RefundMethod = validValue(searchParams.refundMethod, returnRefundMethods, "all");
  const { from, to } = resolveDateFilter(searchParams);
  const [{ rows, total, pageCount }, expandedReturn] = await Promise.all([
    getReturns({
      q: searchParams.q,
      customerId: searchParams.customerId,
      productId: searchParams.productId,
      orderId: searchParams.orderId,
      warehouseId: searchParams.warehouseId,
      reason,
      refundMethod,
      from,
      to,
      minTotal: optionalNumber(searchParams.minTotal),
      maxTotal: optionalNumber(searchParams.maxTotal),
      includeCancelled: searchParams.includeCancelled === "1",
      page,
      pageSize,
    }),
    expandedId ? getReturn(expandedId).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <>
      <ReturnsTable
        rows={rows}
        expandedId={expandedReturn?.id ?? expandedId}
        expandedContent={expandedReturn ? <ReturnDetailPanel ret={expandedReturn} compact /> : null}
        expandedFooter={expandedReturn ? <ReturnDetailFooter ret={expandedReturn} /> : null}
      />
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("returns.title")} />
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
