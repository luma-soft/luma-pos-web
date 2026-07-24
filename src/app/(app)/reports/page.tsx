import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import {
  getReportCustomers,
  getReportEmployees,
  getReportInvoices,
  getReportProducts,
  getReports,
} from "@/lib/data/reports";
import { parsePageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";
import { ReportCustomersTable, ReportEmployeesTable, ReportProductsTable } from "./report-detail-tables";
import { ReportInvoicesTable } from "./report-invoices-table";
import { ReportPeriodFilter, type ReportPeriod } from "./report-period-filter";

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    period?: string;
    range?: string;
    from?: string;
    to?: string;
    customerId?: string;
    customer?: string;
    q?: string;
    source?: string;
    page?: string;
    size?: string;
  }>;
}

const REPORT_PERIODS: readonly ReportPeriod[] = ["7d", "30d", "90d", "this_month", "last_month", "this_year", "custom"];
const REPORT_TABS = [
  { tab: "overview", labelKey: "reports.overview" },
  { tab: "invoices", labelKey: "reports.invoices" },
  { tab: "products", labelKey: "reports.products" },
  { tab: "customers", labelKey: "reports.customers" },
  { tab: "employees", labelKey: "reports.employees" },
];
const REPORT_FILTER_PARAMS = ["period", "range", "from", "to", "customerId", "customer", "q", "source"] as const;

export default async function ReportsPage({ searchParams }: PageProps) {
  const t = await getTranslations();
  const params = await searchParams;
  const activeTab = REPORT_TABS.find((item) => item.tab === params.tab)?.tab ?? "overview";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = parsePageSize(params.size);
  const legacyPeriod = ["7", "30", "90"].includes(params.range ?? "") ? `${params.range}d` : undefined;
  const requestedPeriod = params.period ?? legacyPeriod;
  const period = REPORT_PERIODS.includes(requestedPeriod as ReportPeriod) ? requestedPeriod as ReportPeriod : "30d";
  const dateRange = resolveDateRange(period, params.from, params.to);
  const filters = {
    customerId: typeof params.customerId === "string" ? params.customerId : undefined,
    customer: typeof params.customer === "string" ? params.customer : undefined,
    q: typeof params.q === "string" ? params.q : undefined,
    from: dateRange.from,
    to: dateRange.toExclusive,
  };
  const [data, invoiceResult, productResult, customerResult, employeeResult] = await Promise.all([
    getReports(dateRange.rangeDays, filters),
    activeTab === "invoices"
      ? getReportInvoices(dateRange.rangeDays, filters, page, pageSize)
      : Promise.resolve(null),
    activeTab === "products"
      ? getReportProducts(dateRange.rangeDays, filters, page, pageSize)
      : Promise.resolve(null),
    activeTab === "customers"
      ? getReportCustomers(dateRange.rangeDays, filters, page, pageSize)
      : Promise.resolve(null),
    activeTab === "employees"
      ? getReportEmployees(dateRange.rangeDays, filters, page, pageSize)
      : Promise.resolve(null),
  ]);
  const filterLabel = filters.customer || filters.q || (filters.customerId ? `ID ${filters.customerId.slice(0, 8)}` : "");

  const maxDay = Math.max(1, ...data.byDay.map((d) => Math.abs(Number(d.revenue))));
  const uncollected = data.summary.revenue - data.summary.collected;
  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 bg-surface border-b border-border">
        <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 px-4 pt-2.5 sm:px-6">
          <Text as="h1" weight="bold" className="text-[17px]" text={t("reports.title")} />
          <ReportPeriodFilter period={period} from={dateRange.fromValue} to={dateRange.toValue} />
        </div>
        <div className="px-4 sm:px-6 pb-1.5">
          <GroupTabs base={Routes.Reports} items={REPORT_TABS} preserveParams={REPORT_FILTER_PARAMS} />
        </div>
      </div>

      {filterLabel && (
        <div className="mb-5 rounded-card border border-primary-200 bg-primary-50 px-4 py-3 text-sm font-semibold text-primary-700">
          Báo cáo đang lọc theo khách: {filterLabel}
        </div>
      )}

      {activeTab === "overview" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface rounded-card border border-border p-5">
              <div className="text-sm text-slate-500">{t("reports.revenue")}</div>
              <div className="text-2xl font-bold tabular-nums mt-1">{formatCurrency(data.summary.revenue)}</div>
              {data.summary.refundTotal > 0 && (
                <div className="mt-1 text-xs font-medium text-er">
                  {t("reports.returnsDeducted", { amount: formatCurrency(data.summary.refundTotal) })}
                </div>
              )}
            </div>
            <div className="bg-surface rounded-card border border-border p-5">
              <div className="text-sm text-slate-500">{t("reports.collected")}</div>
              <div className="text-2xl font-bold tabular-nums mt-1 text-ok">{formatCurrency(data.summary.collected)}</div>
            </div>
            <div className="bg-surface rounded-card border border-border p-5">
              <div className="text-sm text-slate-500">{t("reports.uncollected")}</div>
              <div className={cn("text-2xl font-bold tabular-nums mt-1", uncollected > 0 ? "text-er" : "")}>{formatCurrency(uncollected)}</div>
            </div>
            <div className="bg-surface rounded-card border border-border p-5">
              <div className="text-sm text-slate-500">{t("reports.orders")}</div>
              <div className="text-2xl font-bold tabular-nums mt-1">{data.summary.orderCount}</div>
              <div className="text-xs text-slate-400 mt-1">
                {data.summary.orderCount > 0 && t("reports.avgOrder", { avg: formatCurrency(Math.round(data.summary.revenue / data.summary.orderCount)) })}
              </div>
            </div>
          </div>

          <div className="bg-surface rounded-card border border-border p-5">
            <Text as="h2" weight="semibold" className="mb-4" text={t("dashboard.revenueByDay")} />
            {data.byDay.length === 0 ? (
              <Text as="p" variant="muted" className="py-8 text-center" text={t("dashboard.noData")} />
            ) : (
              <div className="flex items-end gap-1 h-44 overflow-x-auto">
                {data.byDay.map((d) => {
                  const v = Number(d.revenue);
                  return (
                    <div key={d.day} className="flex-1 min-w-6 flex flex-col items-center justify-end h-full gap-1" title={`${d.day}: ${formatCurrency(v)}`}>
                      <div
                        className={cn("w-full rounded-t", v < 0 ? "bg-er/85" : "bg-primary-600/85")}
                        style={{ height: `${Math.max(2, (Math.abs(v) / maxDay) * 100)}%` }}
                      />
                      <Text as="span" variant="muted" className="text-[9px] whitespace-nowrap" text={`${d.day.slice(8)}/${d.day.slice(5, 7)}`} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "invoices" && invoiceResult && (
        <>
          <ReportInvoicesTable rows={invoiceResult.rows} />
          <Pagination
            page={invoiceResult.page}
            pageCount={invoiceResult.pageCount}
            total={invoiceResult.total}
            pageSize={invoiceResult.pageSize}
            unitLabel={t("orders.unitLabel")}
          />
        </>
      )}

      {activeTab === "products" && productResult && (
        <ReportTabTable
          table={<ReportProductsTable rows={productResult.rows} />}
          result={productResult}
          unitLabel={t("reports.unitLabels.products")}
        />
      )}

      {activeTab === "customers" && customerResult && (
        <ReportTabTable
          table={<ReportCustomersTable rows={customerResult.rows} />}
          result={customerResult}
          unitLabel={t("reports.unitLabels.customers")}
        />
      )}

      {activeTab === "employees" && employeeResult && (
        <ReportTabTable
          table={<ReportEmployeesTable rows={employeeResult.rows} />}
          result={employeeResult}
          unitLabel={t("reports.unitLabels.employees")}
        />
      )}
    </div>
  );
}

function ReportTabTable({
  table,
  result,
  unitLabel,
}: {
  table: ReactNode;
  result: { page: number; pageCount: number; total: number; pageSize: number };
  unitLabel: string;
}) {
  return (
    <>
      {table}
      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        unitLabel={unitLabel}
      />
    </>
  );
}

function resolveDateRange(period: ReportPeriod, fromParam?: string, toParam?: string) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  let from = addDays(today, -29);
  let toExclusive = tomorrow;

  if (period === "7d") from = addDays(today, -6);
  else if (period === "90d") from = addDays(today, -89);
  else if (period === "this_month") from = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (period === "last_month") {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    toExclusive = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (period === "this_year") {
    from = new Date(today.getFullYear(), 0, 1);
  } else if (period === "custom") {
    const customFrom = parseDate(fromParam);
    const customTo = parseDate(toParam);
    if (customFrom && customTo && customFrom <= customTo) {
      from = customFrom;
      toExclusive = addDays(customTo, 1);
    } else {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    }
  }

  const toInclusive = addDays(toExclusive, -1);
  return {
    from,
    toExclusive,
    fromValue: dateInputValue(from),
    toValue: dateInputValue(toInclusive),
    rangeDays: Math.max(1, Math.round((toExclusive.getTime() - from.getTime()) / 86_400_000)),
  };
}

function parseDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
