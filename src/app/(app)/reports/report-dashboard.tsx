import {
  Banknote,
  CheckCircle2,
  Clock3,
  Info,
  PackageX,
  RotateCcw,
  Star,
  TriangleAlert,
  Trophy,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { FitText } from "@/components/fit-text";
import { cn } from "@/lib/utils";
import type {
  ReportCustomerRow,
  ReportInventory,
  ReportInvoiceRow,
  ReportProductRow,
  ReportsData,
} from "@/lib/data/reports";
import { KpiCarousel, OrderTrendChart, ReportChartTitle, TrendChart } from "./report-charts";
import { useReportFormat } from "./report-format";
import { ReportInvoicesTable } from "./report-invoices-table";
import { ReportCustomersTable, ReportInventoryTable, ReportProductsTable } from "./report-detail-tables";

const COLORS = {
  revenue: "#078c87",
  profit: "#076c3b",
  previousRevenue: "#2563eb",
  previousProfit: "#d97706",
};

export function OverviewReport({ data }: { data: ReportsData }) {
  const f = useReportFormat();
  const { t } = f;
  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label={t("kpi.grossProfit")} value={f.money(data.summary.grossProfit)} delta={data.comparison.grossProfit} featured hint={t("kpi.costHint")} />
        <KpiCard label={t("kpi.netRevenue")} value={f.money(data.summary.revenue)} delta={data.comparison.revenue} />
        <KpiCard label={t("kpi.cost")} value={f.money(data.summary.costOfGoods)} delta={data.comparison.costOfGoods} hint={t("kpi.costHint")} />
        <KpiCard label={t("kpi.margin")} value={f.percent(data.summary.grossMargin)} delta={data.comparison.grossMargin} point />
        <KpiCard label={t("kpi.refunds")} value={f.money(data.summary.refundTotal)} delta={data.comparison.refundTotal} inverse hint={t("kpi.refundsHint")} />
      </KpiGrid>

      <ReportSurface title={<ReportChartTitle rows={data.byDay} kind="trend" />}>
        <ChartLegend items={[
          [t("kpi.netRevenue"), COLORS.revenue],
          [t("kpi.grossProfit"), COLORS.profit],
          [t("trend.previousRevenue"), COLORS.previousRevenue, true],
          [t("trend.previousProfit"), COLORS.previousProfit, true],
        ]} />
        <TrendChart
          rows={data.byDay}
          previous={data.previous.byDay}
          series={[
            { key: "revenue", label: t("kpi.netRevenue"), color: COLORS.revenue, previousLabel: t("trend.previousRevenue"), previousColor: COLORS.previousRevenue },
            { key: "grossProfit", label: t("kpi.grossProfit"), color: COLORS.profit, previousLabel: t("trend.previousProfit"), previousColor: COLORS.previousProfit },
          ]}
        />
      </ReportSurface>

      <div className="grid gap-4 lg:grid-cols-2">
        <CollectionCard data={data} />
        <PaymentMethodCard data={data} />
      </div>
      <StaffCard data={data} />
    </div>
  );
}

export function OrdersReport({ data, rows }: { data: ReportsData; rows: ReportInvoiceRow[] }) {
  const f = useReportFormat();
  const { t } = f;
  const status = data.orderStatus;
  const previous = data.previous.orderStatus;
  return (
    <div className="space-y-4">
      <KpiCarousel count={5}>
        <KpiCard label={t("kpi.orders")} value={f.number(data.summary.operationalOrderCount, 0)} suffix={t("ordersSuffix")} delta={data.comparison.orderCount} featured />
        <KpiCard label={t("kpi.netRevenue")} value={f.money(data.summary.revenue)} delta={data.comparison.revenue} />
        <KpiCard label={t("kpi.avgOrder")} value={f.money(data.summary.averageOrder)} delta={data.comparison.averageOrder} />
        <KpiCard label={t("kpi.grossProfit")} value={f.money(data.summary.grossProfit)} delta={data.comparison.grossProfit} />
        <KpiCard label={t("kpi.returnRate")} value={f.percent(data.summary.returnRate)} delta={data.comparison.returnRate} point inverse />
      </KpiCarousel>
      <ReportSurface title={<ReportChartTitle rows={data.byDay} kind="orderChart" />}>
        <ChartLegend items={[[t("orderChart.completed"), "#087f69"], [t("orderChart.returned"), "#a7cf9a"], [t("orderChart.avg"), "#078c87"]]} />
        <OrderTrendChart rows={data.byDay} />
      </ReportSurface>
      <div className="grid grid-cols-4 gap-2 lg:gap-3">
        <StatusCard icon={<CheckCircle2 />} label={t("status.completed")} value={status.completed} color="text-primary-700" delta={change(status.completed, previous.completed)} />
        <StatusCard icon={<RotateCcw />} label={t("status.returned")} value={status.returned} color="text-emerald-500" delta={change(status.returned, previous.returned)} />
        <StatusCard icon={<Clock3 />} label={t("status.processing")} value={status.processing} color="text-amber-500" delta={change(status.processing, previous.processing)} inverse />
        <StatusCard icon={<XCircle />} label={t("status.cancelled")} value={status.cancelled} color="text-red-600" delta={change(status.cancelled, previous.cancelled)} inverse />
      </div>
      <HourHeatmap data={data} />
      <ReportSurface title={t("invoiceList")} flush>
        <ReportInvoicesTable rows={rows} />
      </ReportSurface>
    </div>
  );
}

export function ProductsReport({ data, rows }: { data: ReportsData; rows: ReportProductRow[] }) {
  const f = useReportFormat();
  const { t } = f;
  const { bestProfit, lowestMargin, mostReturned } = data.productHighlights;
  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label={t("kpi.productsSold")} value={f.number(data.summary.productCount, 0)} delta={data.comparison.productCount} />
        <KpiCard label={t("kpi.quantity")} value={f.number(data.summary.quantitySold)} delta={data.comparison.quantitySold} />
        <KpiCard label={t("kpi.netRevenue")} value={f.money(data.summary.revenue)} delta={data.comparison.revenue} thirdMobile />
        <KpiCard label={t("kpi.grossProfit")} value={f.money(data.summary.grossProfit)} delta={data.comparison.grossProfit} thirdMobile />
        <KpiCard label={t("kpi.margin")} value={f.percent(data.summary.grossMargin)} delta={data.comparison.grossMargin} point thirdMobile />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.8fr]">
        <ReportSurface title={t("products.contribution")}>
          <ChartLegend items={[[t("kpi.netRevenue"), COLORS.revenue], [t("kpi.grossProfit"), COLORS.profit]]} />
          <ContributionBars rows={data.topProducts} />
        </ReportSurface>
        <div className="hidden xl:block">
          <ReportSurface title={t("products.scatter")} subtitle={t("products.scatterSub")}>
            <ScatterChart rows={data.topProducts} />
          </ReportSurface>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <HighlightCard icon={<Trophy />} title={t("products.bestProfit")} name={bestProfit?.productName} value={bestProfit ? f.money(bestProfit.profit) : "—"} note={bestProfit ? t("products.marginOf", { value: f.percent(bestProfit.margin) }) : undefined} tone="success" />
        <HighlightCard icon={<TriangleAlert />} title={t("products.lowMargin")} name={lowestMargin?.productName} value={lowestMargin ? f.percent(lowestMargin.margin) : "—"} note={lowestMargin ? f.money(lowestMargin.revenue) : undefined} tone="danger" />
        <HighlightCard icon={<RotateCcw />} title={t("products.mostReturned")} name={mostReturned?.productName} value={mostReturned ? t("products.returnedQty", { qty: f.number(mostReturned.qtyReturned) }) : "—"} note={mostReturned ? t("products.marginOf", { value: f.percent(mostReturned.margin) }) : undefined} tone="warning" />
      </div>
      <CategoryCard data={data} />
      <ReportSurface title={t("products.performance")} flush>
        <ReportProductsTable rows={rows} />
      </ReportSurface>
    </div>
  );
}

export function CustomersReport({ data, rows }: { data: ReportsData; rows: ReportCustomerRow[] }) {
  const f = useReportFormat();
  const { t } = f;
  const newCustomers = data.customerSegments.new;
  const returningCustomers = data.customerSegments.returning;
  const repeatShare = data.summary.grossProfit === 0 ? 0 : returningCustomers.grossProfit / data.summary.grossProfit * 100;
  const averageCustomer = data.summary.customerCount === 0 ? 0 : data.summary.revenue / data.summary.customerCount;
  const frequency = data.summary.customerCount === 0 ? 0 : data.summary.orderCount / data.summary.customerCount;
  const returningRate = data.summary.customerCount === 0 ? 0 : data.summary.returningCustomerCount / data.summary.customerCount * 100;
  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label={t("kpi.customers")} value={f.number(data.summary.customerCount, 0)} delta={data.comparison.customerCount} featured />
        <KpiCard label={t("kpi.newCustomers")} value={f.number(data.summary.newCustomerCount, 0)} delta={data.comparison.newCustomerCount} />
        <KpiCard label={t("kpi.returning")} value={f.number(data.summary.returningCustomerCount, 0)} delta={data.comparison.returningCustomerCount} />
        <KpiCard label={t("kpi.netRevenue")} value={f.money(data.summary.revenue)} delta={data.comparison.revenue} />
        <KpiCard label={t("kpi.grossProfit")} value={f.money(data.summary.grossProfit)} delta={data.comparison.grossProfit} wideMobile />
      </KpiGrid>
      <ReportSurface title={t("customers.segmentTitle")}>
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <table className="w-full text-sm">
            <thead><tr><th className="pb-3 text-left" /><th className="pb-3 text-right text-slate-500">{t("kpi.newCustomers")}</th><th className="pb-3 text-right text-slate-500">{t("kpi.returning")}</th></tr></thead>
            <tbody className="divide-y divide-border-soft">
              <MetricComparison label={t("kpi.netRevenue")} first={f.money(newCustomers.revenue)} second={f.money(returningCustomers.revenue)} />
              <MetricComparison label={t("kpi.grossProfit")} first={f.money(newCustomers.grossProfit)} second={f.money(returningCustomers.grossProfit)} />
              <MetricComparison label={t("customers.avgPerOrder")} first={f.money(newCustomers.averageOrder)} second={f.money(returningCustomers.averageOrder)} />
              <MetricComparison label={t("kpi.margin")} first={f.percent(newCustomers.grossMargin)} second={f.percent(returningCustomers.grossMargin)} />
            </tbody>
          </table>
          <TrendChart
            rows={data.byDay}
            series={[
              { key: "revenue", label: t("kpi.netRevenue"), color: COLORS.revenue },
              { key: "grossProfit", label: t("kpi.grossProfit"), color: COLORS.profit },
            ]}
          />
        </div>
      </ReportSurface>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1.2fr]">
        <InsightMetric icon={<Users />} label={t("customers.repeatShare")} value={f.percent(repeatShare)} note={t("customers.repeatShareNote")} />
        <InsightMetric icon={<UserRound />} label={t("customers.avgPerCustomer")} value={f.money(averageCustomer)} />
        <InsightMetric icon={<UserRound />} label={t("customers.frequency")} value={f.number(frequency, 2)} note={t("customers.frequencyNote")} />
        <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-4 text-sm text-primary-800 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200">
          <div className="flex items-center gap-2 font-black"><Star className="h-5 w-5 fill-primary-600 text-primary-600" /> {t("customers.returningRate", { rate: f.percent(returningRate) })}</div>
          <p className="mt-1 text-xs leading-relaxed">{data.summary.customerCount === 0 ? t("customers.noIdentified") : t("customers.tip")}</p>
        </div>
      </div>
      <ReportSurface title={t("customers.performance")} flush>
        <ReportCustomersTable rows={rows} />
      </ReportSurface>
    </div>
  );
}

export function InventoryReport({ data }: { data: ReportInventory }) {
  const f = useReportFormat();
  const { t } = f;
  const summary = data.summary;
  return (
    <div className="space-y-4">
      <KpiGrid>
        <StaticKpi label={t("inventory.stockValue")} value={f.money(summary.stockValue)} note={t("inventory.costNote")} featured />
        <StaticKpi label={t("inventory.inStock")} value={f.number(summary.inStock, 0)} />
        <StaticKpi label={t("inventory.slowMoving")} value={f.number(summary.slowMoving, 0)} note={t("inventory.slowMovingValue", { value: f.money(summary.slowMovingValue) })} tone="warning" />
        <StaticKpi label={t("inventory.lowStock")} value={f.number(summary.lowStock, 0)} tone="warning" />
        <StaticKpi label={t("inventory.outOfStock")} value={f.number(summary.outOfStock, 0)} tone="danger" wideMobile />
      </KpiGrid>
      <ReportSurface title={t("inventory.table")} subtitle={t("inventory.tableSub")} flush>
        <ReportInventoryTable rows={data.rows} />
      </ReportSurface>
    </div>
  );
}

function CollectionCard({ data }: { data: ReportsData }) {
  const f = useReportFormat();
  const { t } = f;
  const gross = data.summary.grossRevenue;
  const collected = data.summary.collected;
  const rate = gross === 0 ? 0 : Math.min(100, collected / gross * 100);
  return (
    <ReportSurface title={t("collection.title")}>
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label={t("collection.collected")} value={f.money(collected)} tone="success" />
        <MiniStat label={t("collection.outstanding")} value={f.money(data.summary.outstanding)} tone={data.summary.outstanding > 0 ? "danger" : undefined} />
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-primary-600" style={{ width: `${rate}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        <span>{t("collection.rate", { rate: f.percent(rate) })}</span>
        <span>{t("collection.grossSales")}: <b className="text-slate-700 dark:text-slate-200">{f.money(gross)}</b></span>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{t("collection.note")}</p>
    </ReportSurface>
  );
}

function PaymentMethodCard({ data }: { data: ReportsData }) {
  const f = useReportFormat();
  const { t } = f;
  const rows = data.byPaymentMethod;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <ReportSurface title={t("payment.title")}>
      {rows.length === 0 ? <EmptyNote text={t("payment.empty")} /> : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const share = total === 0 ? 0 : row.amount / total * 100;
            return (
              <li key={row.method}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold"><Banknote className="h-4 w-4 text-primary-600" aria-hidden="true" />{t(`payment.methods.${row.method}`)}</span>
                  <span className="font-black tabular-nums">{f.money(row.amount)}</span>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-primary-600" style={{ width: `${share}%` }} /></div>
                  <span className="w-28 text-right text-[11px] text-slate-500">{f.percent(share)} · {t("payment.transactions", { count: row.count })}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ReportSurface>
  );
}

function StaffCard({ data }: { data: ReportsData }) {
  const f = useReportFormat();
  const { t } = f;
  if (data.byStaff.length === 0) return null;
  return (
    <ReportSurface title={t("staff.title")} subtitle={t("staff.note")} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-surface-2 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">{t("staff.name")}</th>
              <th className="px-4 py-2 text-right font-semibold">{t("staff.orders")}</th>
              <th className="px-4 py-2 text-right font-semibold">{t("staff.revenue")}</th>
              <th className="px-4 py-2 text-right font-semibold">{t("staff.avg")}</th>
              <th className="px-4 py-2 text-right font-semibold">{t("staff.profit")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {data.byStaff.map((row) => (
              <tr key={row.staffId ?? "unknown"}>
                <td className={cn("px-4 py-2.5 font-semibold", !row.staffName && "text-slate-400")}>{row.staffName ?? t("staff.unknown")}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{f.number(row.orderCount, 0)}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{f.currency(row.revenue)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{f.money(row.averageOrder)}</td>
                <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", row.profit < 0 ? "text-er" : "text-ok")}>{f.currency(row.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportSurface>
  );
}

function HourHeatmap({ data }: { data: ReportsData }) {
  const f = useReportFormat();
  const { t } = f;
  const cells = new Map(data.byHour.map((row) => [`${row.weekday}-${row.hour}`, row]));
  const activeHours = data.byHour.map((row) => row.hour);
  if (activeHours.length === 0) return null;
  const firstHour = Math.min(7, ...activeHours);
  const lastHour = Math.max(21, ...activeHours);
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);
  const max = Math.max(1, ...data.byHour.map((row) => row.orderCount));
  const busiest = data.byHour.reduce((best, row) => row.orderCount > best.orderCount ? row : best, data.byHour[0]);
  const dayLabel = (weekday: number) => t(`heatmap.w${weekday}` as "heatmap.w1");
  return (
    <ReportSurface title={t("heatmap.title")} subtitle={t("heatmap.subtitle")}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] gap-1" style={{ gridTemplateColumns: `40px repeat(${hours.length}, minmax(0, 1fr))` }}>
          <span />
          {hours.map((hour) => <span key={hour} className="text-center text-[10px] text-slate-400">{hour}</span>)}
          {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
            <div key={weekday} className="contents">
              <span className="self-center text-xs font-semibold text-slate-500">{dayLabel(weekday)}</span>
              {hours.map((hour) => {
                const cell = cells.get(`${weekday}-${hour}`);
                const intensity = cell ? cell.orderCount / max : 0;
                return (
                  <span
                    key={hour}
                    title={t("heatmap.cell", { day: dayLabel(weekday), hour, orders: cell?.orderCount ?? 0, revenue: f.money(cell?.revenue ?? 0) })}
                    className="aspect-square min-h-5 rounded-[4px] bg-slate-100 dark:bg-slate-800"
                    style={cell ? { backgroundColor: `rgb(7 140 135 / ${0.12 + intensity * 0.88})` } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs font-semibold text-primary-700 dark:text-primary-300">{t("heatmap.busiest", { day: dayLabel(busiest.weekday), hour: busiest.hour })}</p>
    </ReportSurface>
  );
}

function CategoryCard({ data }: { data: ReportsData }) {
  const f = useReportFormat();
  const { t } = f;
  const rows = data.byCategory.slice(0, 12);
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.revenue)));
  return (
    <ReportSurface title={t("category.title")}>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.categoryId ?? "none"} className="grid grid-cols-[minmax(0,160px)_1fr_auto] items-center gap-3 text-sm max-sm:grid-cols-[minmax(0,1fr)_auto]">
            <FitText className={cn("block truncate font-semibold", !row.categoryName && "text-slate-400")}>{row.categoryName ?? t("category.uncategorized")}</FitText>
            <div className="relative h-3 rounded-sm bg-slate-100 max-sm:order-last max-sm:col-span-2 dark:bg-slate-800">
              <div className="absolute inset-y-0 left-0 rounded-sm bg-primary-600" style={{ width: `${Math.max(0, row.revenue) / max * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-sm bg-emerald-800" style={{ width: `${Math.max(0, row.profit) / max * 100}%` }} />
            </div>
            <div className="text-right">
              <div className="font-black tabular-nums">{f.money(row.revenue)}</div>
              <div className="text-[11px] text-slate-500">{t("category.share", { share: f.percent(row.share) })} · {f.percent(row.margin)}</div>
            </div>
          </li>
        ))}
      </ul>
    </ReportSurface>
  );
}

function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-6 gap-3 lg:grid-cols-5">{children}</div>;
}

function cardClassName({ featured, wideMobile, thirdMobile }: { featured?: boolean; wideMobile?: boolean; thirdMobile?: boolean }) {
  return cn(
    "col-span-3 min-h-[112px] snap-start rounded-xl border bg-surface p-4 lg:col-span-1 max-lg:rounded-[18px]",
    featured ? "border-primary-500 max-lg:border-border" : "border-border",
    wideMobile && "col-span-6",
    thirdMobile && "col-span-2 p-3 lg:p-4",
  );
}

function CardLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-1 text-xs font-bold text-slate-700 max-lg:text-[15px] max-lg:font-normal max-lg:text-ios-label-secondary dark:text-slate-300">
      <span className="truncate">{label}</span>
      {hint && <span title={hint} aria-label={hint} className="inline-flex shrink-0 cursor-help text-slate-400"><Info className="h-3.5 w-3.5" aria-hidden="true" /></span>}
    </div>
  );
}

function KpiCard({ label, value, suffix, delta, featured, wideMobile, thirdMobile, point, inverse, hint }: { label: string; value: string; suffix?: string; delta: number | null; featured?: boolean; wideMobile?: boolean; thirdMobile?: boolean; point?: boolean; inverse?: boolean; hint?: string }) {
  // Phones: NativeReportMetricCard — equal tiles, secondary label, accent value.
  return (
    <div className={cardClassName({ featured, wideMobile, thirdMobile })}>
      <CardLabel label={label} hint={hint} />
      <FitText className={cn("mt-2 block truncate font-black tabular-nums tracking-tight max-lg:font-bold max-lg:text-ios-accent", featured ? "text-3xl text-primary-700 max-lg:text-[24px]" : "text-[clamp(1.3rem,2vw,1.8rem)] max-lg:text-[24px]", thirdMobile && "text-lg lg:text-[clamp(1.3rem,2vw,1.8rem)]")} minScale={0.6}>{value}<span className="text-base">{suffix}</span></FitText>
      <Delta value={delta} point={point} inverse={inverse} />
    </div>
  );
}

function StaticKpi({ label, value, note, featured, wideMobile, tone }: { label: string; value: string; note?: string; featured?: boolean; wideMobile?: boolean; tone?: "warning" | "danger" }) {
  return (
    <div className={cardClassName({ featured, wideMobile })}>
      <CardLabel label={label} />
      <FitText className={cn("mt-2 block truncate font-black tabular-nums tracking-tight max-lg:font-bold max-lg:text-ios-accent", featured ? "text-3xl text-primary-700 max-lg:text-[24px]" : "text-[clamp(1.3rem,2vw,1.8rem)] max-lg:text-[24px]", tone === "warning" && "text-amber-600", tone === "danger" && "text-red-600")} minScale={0.6}>{value}</FitText>
      {note && <div className="mt-2 text-[11px] text-slate-500">{note}</div>}
    </div>
  );
}

function Delta({ value, point, inverse }: { value: number | null; point?: boolean; inverse?: boolean }) {
  const f = useReportFormat();
  if (value == null) return <div className="mt-2 text-[10px] text-slate-400">— {f.t("vsPrevious")}</div>;
  const positive = inverse ? value <= 0 : value >= 0;
  return (
    <div data-delta className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
      <span className={cn("rounded-md px-1.5 py-0.5 font-black", positive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300")}>{value >= 0 ? "↑" : "↓"} {f.number(Math.abs(value))}{point ? ` ${f.t("points")}` : "%"}</span>
      <span className="delta-context text-slate-500">{f.t("vsPrevious")}</span>
    </div>
  );
}

function ReportSurface({ title, subtitle, children, flush }: { title: React.ReactNode; subtitle?: string; children: React.ReactNode; flush?: boolean }) {
  const heading = <>{title}{subtitle && <span className="font-medium text-slate-400"> ({subtitle})</span>}</>;
  return (
    <section className={cn("overflow-hidden rounded-xl border border-border bg-surface max-lg:rounded-[22px] max-lg:border-0", !flush && "p-4 max-lg:p-ios-inset", flush && "max-lg:overflow-visible max-lg:bg-transparent")}>
      {flush ? <h2 className="border-b border-border px-4 py-3 text-sm font-black max-lg:border-0 max-lg:px-1 max-lg:pb-2.5 max-lg:pt-0 max-lg:text-[17px] max-lg:font-semibold">{heading}</h2> : <h2 className="mb-3 text-sm font-black max-lg:text-[17px] max-lg:font-semibold">{heading}</h2>}
      {children}
    </section>
  );
}

function ChartLegend({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-600 dark:text-slate-300">
      {items.map(([label, color, dotted]) => (
        <span key={label} className="inline-flex items-center gap-2">
          <span className={cn("h-0.5 w-4", dotted && "border-t-2 border-dotted bg-transparent")} style={{ backgroundColor: dotted ? undefined : color, borderColor: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function StatusCard({ icon, label, value, color, delta, inverse }: { icon: React.ReactNode; label: string; value: number; color: string; delta: number | null; inverse?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 rounded-xl border border-border bg-surface p-2 text-center [&_.delta-context]:hidden lg:flex-row lg:gap-3 lg:p-3 lg:text-left">
      <span className={cn("[&>svg]:h-6 [&>svg]:w-6 lg:[&>svg]:h-9 lg:[&>svg]:w-9", color)}>{icon}</span>
      <div className="min-w-0 max-w-full">
        <FitText className="block truncate text-[10px] text-slate-500 lg:text-xs" minScale={0.85}>{label}</FitText>
        <FitText className="block truncate text-lg font-black lg:text-xl" minScale={0.7}>{value}</FitText>
        <Delta value={delta} inverse={inverse} />
      </div>
    </div>
  );
}

function ContributionBars({ rows }: { rows: ReportsData["topProducts"] }) {
  const f = useReportFormat();
  if (rows.length === 0) return <EmptyNote text={f.t("noData")} />;
  const max = Math.max(1, ...rows.map((row) => Math.max(row.revenue, row.profit)));
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={row.productId} className="grid grid-cols-[18px_minmax(0,140px)_1fr_64px] items-center gap-2 text-[11px]">
          <span className="text-slate-400">{index + 1}</span>
          <FitText className="block truncate" minScale={0.85}>{row.productName}</FitText>
          <div className="relative h-3 rounded-sm bg-slate-100 dark:bg-slate-800">
            <div className="absolute inset-y-0 left-0 rounded-sm bg-primary-600" style={{ width: `${Math.max(0, row.revenue) / max * 100}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-sm bg-emerald-800" style={{ width: `${Math.max(0, row.profit) / max * 100}%` }} />
          </div>
          <FitText className={cn("block truncate text-right font-semibold", row.profit < 0 && "text-red-600")} minScale={0.75}>{f.money(row.profit)}</FitText>
        </div>
      ))}
    </div>
  );
}

function ScatterChart({ rows }: { rows: ReportsData["topProducts"] }) {
  const f = useReportFormat();
  const maxRevenue = Math.max(1, ...rows.map((row) => Math.abs(row.revenue)));
  return (
    <svg viewBox="0 0 420 260" role="img" aria-label={f.t("products.scatterAria")} className="h-56 w-full">
      <line x1="35" y1="125" x2="405" y2="125" stroke="#cbd5e1" />
      <line x1="35" y1="15" x2="35" y2="235" stroke="#cbd5e1" />
      <text x="30" y="24" textAnchor="end" fontSize="10" fill="#64748b">80%</text>
      <text x="30" y="129" textAnchor="end" fontSize="10" fill="#64748b">0%</text>
      <text x="30" y="234" textAnchor="end" fontSize="10" fill="#64748b">−80%</text>
      {rows.map((row) => (
        <circle key={row.productId} cx={35 + Math.abs(row.revenue) / maxRevenue * 360} cy={125 - Math.max(-80, Math.min(80, row.margin)) / 80 * 105} r="5" fill={row.margin < 0 ? "#dc2626" : "#0f9f91"} fillOpacity="0.85">
          <title>{`${row.productName}: ${f.money(row.revenue)} · ${f.percent(row.margin)}`}</title>
        </circle>
      ))}
      <text x="220" y="255" textAnchor="middle" fontSize="10" fill="#64748b">{f.t("products.scatterAxis")}</text>
    </svg>
  );
}

function HighlightCard({ icon, title, name, value, note, tone }: { icon: React.ReactNode; title: string; name?: string; value: string; note?: string; tone: "success" | "danger" | "warning" }) {
  const f = useReportFormat();
  const color = tone === "danger" ? "text-red-600 bg-red-50 dark:bg-red-950/40" : tone === "warning" ? "text-amber-600 bg-amber-50 dark:bg-amber-950/40" : "text-primary-700 bg-primary-50 dark:bg-primary-950/40";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full [&>svg]:h-5 [&>svg]:w-5", color)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-black">{title}</div>
        <FitText className="block truncate text-xs text-slate-600 dark:text-slate-300">{name ?? f.t("noData")}</FitText>
        <FitText className={cn("block truncate text-lg font-black", tone === "danger" && "text-red-600", tone === "success" && "text-primary-700", tone === "warning" && "text-amber-600")} minScale={0.7}>{value}</FitText>
        {note && <div className="text-[10px] text-slate-500">{note}</div>}
      </div>
    </div>
  );
}

function InsightMetric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-50 text-primary-700 dark:bg-primary-950/40 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-500">{label}</div>
        <FitText className="block truncate text-xl font-black text-primary-700" minScale={0.7}>{value}</FitText>
        {note && <div className="text-[10px] text-slate-500">{note}</div>}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <div className="rounded-lg bg-canvas p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <FitText className={cn("mt-1 block truncate text-xl font-black tabular-nums", tone === "success" && "text-primary-700", tone === "danger" && "text-red-600")} minScale={0.7}>{value}</FitText>
    </div>
  );
}

function MetricComparison({ label, first, second }: { label: string; first: string; second: string }) {
  return <tr><td className="py-3 text-slate-600 dark:text-slate-300">{label}</td><td className="py-3 text-right font-black">{first}</td><td className="py-3 text-right font-black">{second}</td></tr>;
}

function EmptyNote({ text }: { text: string }) {
  return <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-slate-400"><PackageX className="h-4 w-4" aria-hidden="true" />{text}</div>;
}

function change(current: number, previous: number) { return previous === 0 ? current === 0 ? 0 : null : (current - previous) / Math.abs(previous) * 100; }
