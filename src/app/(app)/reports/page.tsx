import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GroupTabs } from "@/components/group-tabs";
import { ChevronLeft } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { Text } from "@/components/ui/text";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getReportCustomers, getReportInvoices, getReportProducts, getReports } from "@/lib/data/reports";
import { parsePageSize } from "@/lib/pagination";
import { Routes } from "@/lib/routes";
import { CustomersReport, OrdersReport, OverviewReport, ProductsReport } from "./report-dashboard";
import { ReportPeriodFilter, type ReportPeriod } from "./report-period-filter";
import { formatReportRange } from "./report-period-label";

interface PageProps {
  searchParams: Promise<{
    tab?: string; period?: string; range?: string; from?: string; to?: string;
    customerId?: string; customer?: string; q?: string; source?: string;
    page?: string; size?: string;
  }>;
}

const REPORT_PERIODS: readonly ReportPeriod[] = ["today", "week", "7d", "30d", "90d", "this_month", "last_month", "this_year", "custom"];
const REPORT_TABS = [
  { tab: "overview", labelKey: "reports.overview" },
  { tab: "invoices", labelKey: "reports.invoices" },
  { tab: "products", labelKey: "reports.products" },
  { tab: "customers", labelKey: "reports.customers" },
];
const REPORT_FILTER_PARAMS = ["period", "range", "from", "to", "customerId", "customer", "q", "source"] as const;

export default async function ReportsPage({ searchParams }: PageProps) {
  const context = await requireStoreContext();
  const t = await getTranslations();
  const params = await searchParams;
  const activeTab = REPORT_TABS.find((item) => item.tab === params.tab)?.tab ?? "overview";
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = parsePageSize(params.size);
  const legacyPeriod = ["7", "30", "90"].includes(params.range ?? "") ? `${params.range}d` : undefined;
  const requestedPeriod = params.period ?? legacyPeriod;
  const period = REPORT_PERIODS.includes(requestedPeriod as ReportPeriod) ? requestedPeriod as ReportPeriod : "today";
  const dateRange = resolveDateRange(period, params.from, params.to);
  const filters = {
    customerId: typeof params.customerId === "string" ? params.customerId : undefined,
    customer: typeof params.customer === "string" ? params.customer : undefined,
    q: typeof params.q === "string" ? params.q : undefined,
    from: dateRange.from,
    to: dateRange.toExclusive,
  };
  const [data, invoices, products, reportCustomers] = await Promise.all([
    getReports(context.storeId, dateRange.rangeDays, filters),
    activeTab === "invoices" ? getReportInvoices(context.storeId, dateRange.rangeDays, filters, page, pageSize) : null,
    activeTab === "products" ? getReportProducts(context.storeId, dateRange.rangeDays, filters, page, pageSize) : null,
    activeTab === "customers" ? getReportCustomers(context.storeId, dateRange.rangeDays, filters, page, pageSize) : null,
  ]);
  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        {/* Phones: ReportsView's bar — back, centred title with the period, filter button. */}
        <div className="px-ios-inset pb-1 pt-[calc(env(safe-area-inset-top)+0.5rem)] lg:hidden">
          <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
            <Link href={Routes.More} aria-label={t("common.back")} data-button-radius="pill" className="grid size-11 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)]">
              <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
            </Link>
            <div className="min-w-0 text-center">
              <h1 className="truncate text-[17px] font-semibold">{t("reports.title")}</h1>
              <p className="truncate text-[13px] text-ios-label-secondary">{period === "custom" ? formatReportRange(dateRange.fromValue, dateRange.toValue) : t(`reports.period.options.${period}` as never)}</p>
            </div>
            <ReportPeriodFilter period={period} from={dateRange.fromValue} to={dateRange.toValue} mobileTrigger="circle" />
          </div>
          <div className="-mx-ios-inset mt-1"><GroupTabs base={Routes.Reports} items={REPORT_TABS} preserveParams={REPORT_FILTER_PARAMS} edgeToEdge linkClassName="h-11" /></div>
        </div>
        <div className="hidden lg:block">
          <div className="flex min-h-[58px] items-center px-6 pt-2">
            <Text as="h1" weight="bold" className="text-2xl" text={t("reports.title")} />
          </div>
          <div className="flex items-end justify-between px-6 pb-2">
            <div className="min-w-0 flex-1 pr-6"><GroupTabs base={Routes.Reports} items={REPORT_TABS} preserveParams={REPORT_FILTER_PARAMS} /></div>
            <div className="flex shrink-0 items-center gap-3"><ReportPeriodFilter period={period} from={dateRange.fromValue} to={dateRange.toValue} /></div>
          </div>
        </div>
      </header>
      <main className="p-3 sm:p-5 lg:p-6">
        {(filters.customer || filters.q || filters.customerId) && <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm font-semibold text-primary-700">Báo cáo đang lọc theo khách: {filters.customer || filters.q || filters.customerId}</div>}
        {activeTab === "overview" && <OverviewReport data={data} />}
        {activeTab === "invoices" && invoices && <><OrdersReport data={data} rows={invoices.rows} /><Pagination page={invoices.page} pageCount={invoices.pageCount} total={invoices.total} pageSize={invoices.pageSize} unitLabel="đơn" /></>}
        {activeTab === "products" && products && <><ProductsReport data={data} rows={products.rows} /><Pagination page={products.page} pageCount={products.pageCount} total={products.total} pageSize={products.pageSize} unitLabel="sản phẩm" /></>}
        {activeTab === "customers" && reportCustomers && <><CustomersReport data={data} rows={reportCustomers.rows} /><Pagination page={reportCustomers.page} pageCount={reportCustomers.pageCount} total={reportCustomers.total} pageSize={reportCustomers.pageSize} unitLabel="khách hàng" /></>}
      </main>
    </div>
  );
}


function resolveDateRange(period: ReportPeriod, fromParam?: string, toParam?: string) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  let from = new Date(today.getFullYear(), today.getMonth(), 1);
  let toExclusive = tomorrow;
  if (period === "today") from = today;
  else if (period === "week") from = addDays(today, -((today.getDay() + 6) % 7));
  else if (period === "7d") from = addDays(today, -6);
  else if (period === "30d") from = addDays(today, -29);
  else if (period === "90d") from = addDays(today, -89);
  else if (period === "last_month") { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); toExclusive = new Date(today.getFullYear(), today.getMonth(), 1); }
  else if (period === "this_year") from = new Date(today.getFullYear(), 0, 1);
  else if (period === "custom") {
    const customFrom = parseDate(fromParam); const customTo = parseDate(toParam);
    if (customFrom && customTo && customFrom <= customTo) { from = customFrom; toExclusive = addDays(customTo, 1); }
  }
  const toInclusive = addDays(toExclusive, -1);
  return { from, toExclusive, fromValue: dateInputValue(from), toValue: dateInputValue(toInclusive), rangeDays: Math.max(1, Math.round((toExclusive.getTime() - from.getTime()) / 86_400_000)) };
}
function parseDate(value?: string) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
function startOfDay(value: Date) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function addDays(value: Date, days: number) { const date = new Date(value); date.setDate(date.getDate() + days); return date; }
function dateInputValue(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
