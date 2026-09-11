import Link from "next/link";
import { AlertTriangle, BookOpen } from "lucide-react";
import { MobileTopBar } from "@/components/mobile-ui";
import { GroupTabs } from "@/components/group-tabs";
import { Pagination } from "@/components/pagination";
import { Text } from "@/components/ui/text";
import { requireStoreRole } from "@/lib/auth/store-context";
import { resolveRevenueBook } from "@/lib/accounting/revenue-book";
import { getAccountingAuxiliaryBooks, getRevenueBook, getTaxActivityRevenue, getTaxClassificationProducts } from "@/lib/data/accounting";
import { getRawStorePrefs } from "@/lib/data/settings";
import { parsePageSize } from "@/lib/pagination";
import { Routes } from "@/lib/routes";
import { formatCurrency } from "@/lib/utils";
import { ReportExportButton } from "../reports/report-export-button";
import { ReportPeriodFilter, type ReportPeriod } from "../reports/report-period-filter";
import { RevenueBookFilters } from "./revenue-book-filters";
import { RevenueBookTable } from "./revenue-book-table";
import { CashDetailBook, IncomeExpenseBook, InventoryDetailBook, OtherTaxBook, TaxActivityRevenueBook } from "./accounting-book-tables";
import { TaxClassificationEditor } from "./tax-classification-editor";
import { OtherTaxForm } from "./other-tax-form";

export const dynamic = "force-dynamic";

type SearchParams = {
  tab?: string;
  period?: string;
  from?: string;
  to?: string;
  q?: string;
  document?: string;
  einvoice?: string;
  page?: string;
  size?: string;
};

const PERIODS: readonly ReportPeriod[] = ["today", "7d", "30d", "90d", "this_month", "last_month", "this_year", "custom"];

export default async function AccountingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await requireStoreRole(["owner", "manager"]);
  const params = await searchParams;
  const prefs = await getRawStorePrefs(context.storeId);
  const book = resolveRevenueBook(prefs.tax.calculationMethod);
  const allowedTabs = prefs.tax.calculationMethod === "taxable_income"
    ? ["revenue", "income-expense", "inventory", "cash", "other-tax", "classification"]
    : ["revenue", "other-tax", "classification"];
  const activeTab = allowedTabs.includes(params.tab ?? "") ? params.tab! : "revenue";
  const period = PERIODS.includes(params.period as ReportPeriod) ? params.period as ReportPeriod : "this_month";
  const dateRange = resolveDateRange(period, params.from, params.to);
  const periodFilter = <ReportPeriodFilter period={period} from={dateRange.fromValue} to={dateRange.toValue} basePath={Routes.Accounting} />;

  if (!book) {
    return (
      <div className="min-h-full bg-canvas">
        <MobileTopBar title="Sổ kế toán" subtitle="Chưa xác định phương pháp tính thuế" />
        <header className="hidden min-h-[64px] items-center border-b border-border bg-surface px-6 lg:flex"><Text as="h1" weight="bold" className="text-2xl" text="Sổ kế toán" /></header>
        <main className="p-4 sm:p-6">
          <section className="mx-auto max-w-2xl rounded-card border border-warn/30 bg-surface p-6 text-center shadow-e1">
            <AlertTriangle className="mx-auto h-10 w-10 text-warn" />
            <h2 className="mt-3 text-lg font-bold">Cần hoàn tất cài đặt thuế</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Luma cần biết phương pháp tính thuế để chọn đúng mẫu sổ S1a, S2a hoặc S2b-HKD. Dữ liệu bán hàng hiện tại vẫn được giữ nguyên.</p>
            <Link href={`${Routes.Settings}?tab=tax`} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary-700 px-4 text-sm font-bold text-white hover:bg-primary-800">Mở cài đặt thuế</Link>
          </section>
        </main>
      </div>
    );
  }

  const pageSize = parsePageSize(params.size);
  const data = await getRevenueBook(context.storeId, prefs.tax, {
    from: dateRange.from,
    to: dateRange.toExclusive,
    q: params.q,
    document: params.document === "sale" || params.document === "return" ? params.document : "all",
    einvoice: params.einvoice === "issued" || params.einvoice === "none" ? params.einvoice : "all",
    page: Number(params.page) || 1,
    pageSize,
  });
  const activityRevenue = book.code === "S2a-HKD"
    ? await getTaxActivityRevenue(context.storeId, dateRange.from, dateRange.toExclusive)
    : [];
  const activityNeedsClassification = activityRevenue.some((row) => !row.activityId);
  const auxiliary = activeTab === "income-expense" || activeTab === "inventory" || activeTab === "cash" || activeTab === "other-tax"
    ? await getAccountingAuxiliaryBooks(context.storeId, dateRange.from, dateRange.toExclusive)
    : null;
  const classificationProducts = activeTab === "classification" ? await getTaxClassificationProducts(context.storeId) : null;
  const exportData = data.total <= data.rows.length ? data : await getRevenueBook(context.storeId, prefs.tax, {
    from: dateRange.from,
    to: dateRange.toExclusive,
    q: params.q,
    document: params.document === "sale" || params.document === "return" ? params.document : "all",
    einvoice: params.einvoice === "issued" || params.einvoice === "none" ? params.einvoice : "all",
    page: 1,
    pageSize: Math.min(data.total, 50_000),
  });
  const showActivity = book.code === "S2a-HKD";
  const exportRows: (string | number | null)[][] = [[
    "Ngày tháng", "Mã giao dịch", "Diễn giải",
    ...(showActivity ? ["Nhóm ngành", "% GTGT", "% TNCN"] : []),
    "Số tiền", "Kênh bán", "Số HĐĐT", "Ký hiệu HĐĐT", "Người tạo",
  ], ...exportData.rows.map((row) => [
    row.date.toISOString(), row.code, row.description,
    ...(showActivity ? [row.activityName, row.vatRate, row.pitRate] : []),
    row.amount, row.salesChannel, row.einvoiceNumber, row.einvoiceSerial, row.createdByName,
  ])];
  const exportButton = <ReportExportButton rows={exportRows} label="Tải sổ" filenamePrefix={`so-doanh-thu-${book.code.toLowerCase()}`} />;

  return (
    <div className="min-h-full bg-canvas">
      <MobileTopBar title="Sổ kế toán" subtitle={`${book.title} (${book.code})`} trailing={<ReportExportButton rows={exportRows} iconOnly label="Tải sổ" filenamePrefix={`so-doanh-thu-${book.code.toLowerCase()}`} />} bottom={periodFilter} />
      <header className="sticky top-0 z-20 hidden border-b border-border bg-surface lg:block">
        <div className="flex min-h-[64px] items-center justify-between px-6">
          <div><Text as="h1" weight="bold" className="text-2xl" text="Sổ kế toán" /><p className="text-xs font-medium text-slate-500">{book.title} · {book.code}</p></div>
          <div className="flex items-center gap-3">{periodFilter}{exportButton}</div>
        </div>
      </header>
      <main className="space-y-4 p-3 sm:p-5 lg:p-6">
        <GroupTabs base={Routes.Accounting} items={[
          { tab: "revenue", labelKey: "accounting.tabs.revenue" },
          ...(prefs.tax.calculationMethod === "taxable_income" ? [
            { tab: "income-expense", labelKey: "accounting.tabs.incomeExpense" },
            { tab: "inventory", labelKey: "accounting.tabs.inventory" },
            { tab: "cash", labelKey: "accounting.tabs.cash" },
          ] : []),
          { tab: "other-tax", labelKey: "accounting.tabs.otherTax" },
          { tab: "classification", labelKey: "accounting.tabs.classification" },
        ]} preserveParams={["period", "from", "to"]} />
        {activeTab === "revenue" && <>
        <section className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="rounded-card border border-border bg-surface p-4 shadow-e1">
            <div className="flex items-start gap-3"><BookOpen className="mt-0.5 h-5 w-5 text-primary-700" /><div><div className="font-bold">{book.title} ({book.code})</div><p className="mt-1 text-sm text-slate-500">{book.description}</p></div></div>
          </div>
          <div className="rounded-card border border-border bg-surface p-4 text-right shadow-e1 sm:min-w-64">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Tổng doanh thu trong kỳ</div>
            <div className="mt-1 text-2xl font-black tabular-nums">{formatCurrency(data.totalRevenue)}</div>
          </div>
        </section>
        {activityNeedsClassification && (
          <div className="rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-slate-700">
            <span className="font-bold text-warn">Cần phân loại nhóm ngành:</span> cửa hàng đang có nhiều hoặc chưa có nhóm ngành tính thuế. Luma chưa tự gán để tránh kê khai sai tỷ lệ.
          </div>
        )}
        {showActivity && <TaxActivityRevenueBook rows={activityRevenue} />}
        <RevenueBookFilters />
        <RevenueBookTable rows={data.rows} showActivity={showActivity} />
        <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} unitLabel="giao dịch" />
        </>}
        {activeTab === "income-expense" && auxiliary && <><BookHeading code="S2c-HKD" title="Sổ chi tiết doanh thu, chi phí" /><IncomeExpenseBook revenue={exportData.rows} purchases={auxiliary.purchases} expenses={auxiliary.expenses} /></>}
        {activeTab === "inventory" && auxiliary && <><BookHeading code="S2d-HKD" title="Sổ chi tiết vật liệu, dụng cụ, sản phẩm, hàng hóa" /><InventoryDetailBook rows={auxiliary.inventory} /></>}
        {activeTab === "cash" && auxiliary && <><BookHeading code="S2e-HKD" title="Sổ chi tiết tiền" /><CashDetailBook rows={auxiliary.cash} /></>}
        {activeTab === "other-tax" && auxiliary && <><BookHeading code="S3a-HKD" title="Sổ theo dõi nghĩa vụ thuế khác" /><OtherTaxForm /><OtherTaxBook rows={auxiliary.taxes} /></>}
        {activeTab === "classification" && classificationProducts && <><BookHeading code="" title="Phân loại nhóm ngành tính thuế cho sản phẩm" /><TaxClassificationEditor products={classificationProducts} activities={prefs.tax.businessActivities.filter((item) => item.enabled)} /></>}
      </main>
    </div>
  );
}

function BookHeading({ code, title }: { code: string; title: string }) {
  return <div className="rounded-card border border-border bg-surface p-4 shadow-e1"><div className="font-bold">{title}{code ? ` (${code})` : ""}</div><p className="mt-1 text-sm text-slate-500">Dữ liệu được tổng hợp tự động từ chứng từ đã hoàn tất trong kỳ đã chọn.</p></div>;
}

function resolveDateRange(period: ReportPeriod, fromParam?: string, toParam?: string) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  let from = new Date(today.getFullYear(), today.getMonth(), 1);
  let toExclusive = tomorrow;
  if (period === "today") from = today;
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
  return { from, toExclusive, fromValue: dateInputValue(from), toValue: dateInputValue(toInclusive) };
}
function parseDate(value?: string) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? null : date; }
function startOfDay(value: Date) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function addDays(value: Date, days: number) { const date = new Date(value); date.setDate(date.getDate() + days); return date; }
function dateInputValue(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
