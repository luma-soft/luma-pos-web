import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GroupTabs } from "@/components/group-tabs";
import { ChevronLeft } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { Text } from "@/components/ui/text";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getReportCustomers, getReportInventory, getReportInvoices, getReportProducts, getReports } from "@/lib/data/reports";
import { parsePageSize } from "@/lib/pagination";
import { Routes } from "@/lib/routes";
import { isReportPeriod, resolveReportRange } from "@/lib/reports/period";
import { CustomersReport, InventoryReport, OrdersReport, OverviewReport, ProductsReport } from "./report-dashboard";
import { ReportExportButton } from "./report-export-button";
import { ReportPeriodFilter } from "./report-period-filter";
import { formatReportRange } from "./report-period-label";

interface PageProps {
  searchParams: Promise<{
    tab?: string; period?: string; range?: string; from?: string; to?: string;
    customerId?: string; customer?: string; q?: string; source?: string;
    page?: string; size?: string;
  }>;
}

const REPORT_TABS = [
  { tab: "overview", labelKey: "reports.overview" },
  { tab: "invoices", labelKey: "reports.invoices" },
  { tab: "products", labelKey: "reports.products" },
  { tab: "customers", labelKey: "reports.customers" },
  { tab: "inventory", labelKey: "reports.inventory" },
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
  const period = isReportPeriod(requestedPeriod) ? requestedPeriod : "today";
  const dateRange = resolveReportRange(period, params.from, params.to);
  const filters = {
    customerId: typeof params.customerId === "string" ? params.customerId : undefined,
    customer: typeof params.customer === "string" ? params.customer : undefined,
    q: typeof params.q === "string" ? params.q : undefined,
    from: dateRange.from,
    to: dateRange.toExclusive,
  };
  const [data, invoices, products, reportCustomers, inventory] = await Promise.all([
    activeTab === "inventory" ? null : getReports(context.storeId, dateRange.rangeDays, filters),
    activeTab === "invoices" ? getReportInvoices(context.storeId, dateRange.rangeDays, filters, page, pageSize) : null,
    activeTab === "products" ? getReportProducts(context.storeId, dateRange.rangeDays, filters, page, pageSize) : null,
    activeTab === "customers" ? getReportCustomers(context.storeId, dateRange.rangeDays, filters, page, pageSize) : null,
    activeTab === "inventory" ? getReportInventory(context.storeId, dateRange.rangeDays, filters, page, pageSize) : null,
  ]);
  const unitLabel = (key: string) => t(`reports.unitLabels.${key}` as never);
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
            <div className="flex shrink-0 items-center gap-3"><ReportExportButton tab={activeTab} /><ReportPeriodFilter period={period} from={dateRange.fromValue} to={dateRange.toValue} /></div>
          </div>
        </div>
      </header>
      <main className="p-3 sm:p-5 lg:p-6">
        {(filters.customer || filters.q || filters.customerId) && <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm font-semibold text-primary-700">{t("reports.d.filteredBy", { name: filters.customer || filters.q || filters.customerId || "" })}</div>}
        {activeTab === "overview" && data && <OverviewReport data={data} />}
        {activeTab === "invoices" && data && invoices && <><OrdersReport data={data} rows={invoices.rows} /><Pagination page={invoices.page} pageCount={invoices.pageCount} total={invoices.total} pageSize={invoices.pageSize} unitLabel={unitLabel("orders")} /></>}
        {activeTab === "products" && data && products && <><ProductsReport data={data} rows={products.rows} /><Pagination page={products.page} pageCount={products.pageCount} total={products.total} pageSize={products.pageSize} unitLabel={unitLabel("products")} /></>}
        {activeTab === "customers" && data && reportCustomers && <><CustomersReport data={data} rows={reportCustomers.rows} /><Pagination page={reportCustomers.page} pageCount={reportCustomers.pageCount} total={reportCustomers.total} pageSize={reportCustomers.pageSize} unitLabel={unitLabel("customers")} /></>}
        {activeTab === "inventory" && inventory && <><InventoryReport data={inventory} /><Pagination page={inventory.page} pageCount={inventory.pageCount} total={inventory.total} pageSize={inventory.pageSize} unitLabel={unitLabel("products")} /></>}
      </main>
    </div>
  );
}
