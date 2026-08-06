import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { FileSpreadsheet } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { TableSkeleton } from "@/components/table-skeleton";
import {
  getOrders,
  type OrderStatusFilter,
} from "@/lib/data/orders";
import {
  DEFAULT_ORDER_TIME_PRESET,
  isOrderTimePreset,
  resolveOrderTimePreset,
  type OrderTimePreset,
} from "@/lib/orders/filter-date-range";
import { parsePageSize } from "@/lib/pagination";
import { DocumentFilterDrawer } from "./document-filter-drawer";
import { QuotesTable } from "./quotes-table";

type SP = Record<string, string | undefined>;
const QUOTE_STATUSES: OrderStatusFilter[] = ["quote", "all", "cancelled"];

export async function QuotesTab({ searchParams }: { searchParams: SP }) {
  const status = validValue(searchParams.status, QUOTE_STATUSES, "quote");
  const { timePreset, from, to } = resolveDateFilter(searchParams);

  return (
    <>
      <DocumentFilterDrawer
        key={searchParamsKey(searchParams)}
        kind="quotes"
        values={{
          q: searchParams.q ?? "",
          customerId: searchParams.customerId ?? "",
          customerLabel: searchParams.customerLabel ?? "",
          productId: searchParams.productId ?? "",
          productLabel: searchParams.productLabel ?? "",
          projectId: searchParams.projectId ?? "",
          projectLabel: searchParams.projectLabel ?? "",
          projectQuery: searchParams.projectQuery ?? "",
          timePreset,
          from,
          to,
          status,
          minTotal: searchParams.minTotal ?? "",
          maxTotal: searchParams.maxTotal ?? "",
        }}
      />
      <Suspense fallback={<TableSkeleton cols={6} rows={10} />}>
        <QuotesContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function QuotesContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const status = validValue(searchParams.status, QUOTE_STATUSES, "quote");
  const { from, to } = resolveDateFilter(searchParams);
  const page = positiveInteger(searchParams.page);
  const pageSize = parsePageSize(searchParams.size);
  const { rows, total, pageCount } = await getOrders({
    documentType: "quote",
    q: searchParams.q,
    customerId: searchParams.customerId,
    productId: searchParams.productId,
    projectId: searchParams.projectId,
    projectQuery: searchParams.projectQuery,
    status,
    from,
    to,
    minTotal: optionalNumber(searchParams.minTotal),
    maxTotal: optionalNumber(searchParams.maxTotal),
    page,
    pageSize,
  });

  return (
    <>
      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface p-12 text-center text-slate-400">
          <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 opacity-60" />
          <p className="font-medium">{t("quotes.empty")}</p>
          <p className="mt-1 text-sm">{t("quotes.emptyHint")}</p>
        </div>
      ) : (
        <QuotesTable rows={rows} />
      )}
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} unitLabel={t("quotes.title")} />
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
