import {
  CheckCircle2,
  Clock3,
  RotateCcw,
  Star,
  TriangleAlert,
  Trophy,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import type {
  ReportCustomerRow,
  ReportInvoiceRow,
  ReportProductRow,
  ReportsData,
} from "@/lib/data/reports";
import { ReportInvoicesTable } from "./report-invoices-table";
import { ReportCustomersTable, ReportProductsTable } from "./report-detail-tables";

export function OverviewReport({ data }: { data: ReportsData }) {
  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label="Lãi gộp" value={compactMoney(data.summary.grossProfit)} delta={data.comparison.grossProfit} featured wideMobile />
        <KpiCard label="Doanh thu thuần" value={compactMoney(data.summary.revenue)} delta={data.comparison.revenue} />
        <KpiCard label="Giá vốn" value={compactMoney(data.summary.costOfGoods)} delta={data.comparison.costOfGoods} />
        <KpiCard label="Biên lãi gộp" value={percent(data.summary.grossMargin)} delta={data.comparison.grossMargin} point />
        <KpiCard label="Hoàn trả" value={compactMoney(data.summary.refundTotal)} delta={data.comparison.refundTotal} inverse />
      </KpiGrid>

      <ReportSurface title="Doanh thu & lãi gộp theo ngày">
        <ChartLegend items={[["Doanh thu thuần", "#078c87"], ["Lãi gộp", "#076c3b"], ["Doanh thu kỳ trước", "#2563eb", true], ["Lãi gộp kỳ trước", "#d97706", true]]} />
        <LineChart
          rows={data.byDay}
          previous={data.previous.byDay}
          series={[
            { key: "revenue", color: "#078c87", previousColor: "#2563eb" },
            { key: "grossProfit", color: "#076c3b", previousColor: "#d97706" },
          ]}
          fullWidth
        />
      </ReportSurface>

    </div>
  );
}

export function OrdersReport({ data, rows }: { data: ReportsData; rows: ReportInvoiceRow[] }) {
  const status = data.orderStatus;
  return (
    <div className="space-y-4">
      <KpiGrid mobileCarousel>
        <KpiCard label="Đơn hàng" value={formatNumber(data.summary.operationalOrderCount)} suffix=" đơn" delta={data.comparison.orderCount} featured />
        <KpiCard label="Doanh thu thuần" value={compactMoney(data.summary.revenue)} delta={data.comparison.revenue} />
        <KpiCard label="Giá trị TB" value={compactMoney(data.summary.averageOrder)} delta={data.comparison.averageOrder} />
        <KpiCard label="Lãi gộp" value={compactMoney(data.summary.grossProfit)} delta={data.comparison.grossProfit} />
        <KpiCard label="Tỷ lệ hoàn" value={percent(data.summary.returnRate)} delta={data.comparison.returnRate} point inverse />
      </KpiGrid>
      <ReportSurface title="Đơn hàng theo ngày">
        <ChartLegend items={[["Đơn hoàn thành", "#087f69"], ["Đơn hoàn trả", "#a7cf9a"], ["Giá trị TB", "#078c87"]]} />
        <OrderChart rows={data.byDay} />
      </ReportSurface>
      <div className="grid grid-cols-4 gap-2 lg:gap-3">
        <StatusCard icon={<CheckCircle2 />} label="Hoàn thành" value={status.completed} color="text-primary-700" delta={change(status.completed, data.previous.orderStatus.completed)} />
        <StatusCard icon={<RotateCcw />} label="Hoàn trả" value={status.returned} color="text-emerald-500" delta={change(status.returned, data.previous.orderStatus.returned)} />
        <StatusCard icon={<Clock3 />} label="Đang xử lý" value={status.processing} color="text-amber-500" delta={change(status.processing, data.previous.orderStatus.processing)} inverse />
        <StatusCard icon={<XCircle />} label="Đã hủy" value={status.cancelled} color="text-red-600" delta={change(status.cancelled, data.previous.orderStatus.cancelled)} inverse />
      </div>
      <ReportSurface title="Chi tiết đơn hàng" flush>
        <ReportInvoicesTable rows={rows} />
      </ReportSurface>
    </div>
  );
}

export function ProductsReport({ data, rows }: { data: ReportsData; rows: ReportProductRow[] }) {
  const best = rows[0] ?? data.topProducts[0];
  const lowMargin = [...rows].sort((a, b) => a.margin - b.margin)[0];
  const mostReturned = [...rows].sort((a, b) => b.returnCount - a.returnCount)[0];
  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label="Sản phẩm bán" value={formatNumber(data.summary.productCount)} delta={data.comparison.productCount} />
        <KpiCard label="Số lượng" value={formatNumber(Math.round(data.summary.quantitySold))} delta={data.comparison.quantitySold} />
        <KpiCard label="Doanh thu thuần" value={compactMoney(data.summary.revenue)} delta={data.comparison.revenue} thirdMobile />
        <KpiCard label="Lãi gộp" value={compactMoney(data.summary.grossProfit)} delta={data.comparison.grossProfit} thirdMobile />
        <KpiCard label="Biên lãi gộp" value={percent(data.summary.grossMargin)} delta={data.comparison.grossMargin} point thirdMobile />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.8fr]">
        <ReportSurface title="Đóng góp doanh thu & lãi gộp">
          <ChartLegend items={[["Doanh thu thuần", "#078c87"], ["Lãi gộp", "#076c3b"]]} />
          <ContributionBars rows={rows.slice(0, 10)} />
        </ReportSurface>
        <div className="hidden xl:block">
          <ReportSurface title="Biên lãi theo sản phẩm" subtitle="Mỗi điểm là 1 sản phẩm">
            <ScatterChart rows={rows} />
          </ReportSurface>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <HighlightCard icon={<Trophy />} title="Lãi cao nhất" row={best} value={best ? compactMoney(best.profit) : "—"} tone="success" />
        <HighlightCard icon={<TriangleAlert />} title="Biên lãi thấp" row={lowMargin} value={lowMargin ? percent(lowMargin.margin) : "—"} tone="danger" />
        <HighlightCard icon={<RotateCcw />} title="Hoàn trả nhiều" row={mostReturned} value={mostReturned ? formatNumber(mostReturned.returnCount) : "—"} tone="warning" />
      </div>
      <ReportSurface title="Hiệu quả sản phẩm" flush>
        <ReportProductsTable rows={rows} />
      </ReportSurface>
    </div>
  );
}

export function CustomersReport({ data, rows }: { data: ReportsData; rows: ReportCustomerRow[] }) {
  const identifiedRows = rows.filter((row) => row.customerId != null);
  const returningRevenue = identifiedRows.filter((row) => row.segment === "returning").reduce((sum, row) => sum + row.revenue, 0);
  const newRevenue = identifiedRows.filter((row) => row.segment === "new").reduce((sum, row) => sum + row.revenue, 0);
  const returningProfit = identifiedRows.filter((row) => row.segment === "returning").reduce((sum, row) => sum + row.profit, 0);
  const repeatShare = data.summary.grossProfit === 0 ? 0 : returningProfit / data.summary.grossProfit * 100;
  const averageCustomer = data.summary.customerCount === 0 ? 0 : data.summary.revenue / data.summary.customerCount;
  const frequency = data.summary.customerCount === 0 ? 0 : data.summary.orderCount / data.summary.customerCount;
  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label="Khách hàng" value={formatNumber(data.summary.customerCount)} delta={data.comparison.customerCount} featured />
        <KpiCard label="Khách mới" value={formatNumber(data.summary.newCustomerCount)} delta={data.comparison.newCustomerCount} />
        <KpiCard label="Quay lại" value={formatNumber(data.summary.returningCustomerCount)} delta={data.comparison.returningCustomerCount} />
        <KpiCard label="Doanh thu thuần" value={compactMoney(data.summary.revenue)} delta={data.comparison.revenue} />
        <KpiCard label="Lãi gộp" value={compactMoney(data.summary.grossProfit)} delta={data.comparison.grossProfit} wideMobile />
      </KpiGrid>
      <ReportSurface title="Doanh thu & lãi gộp theo nhóm khách">
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <table className="w-full text-sm">
            <thead><tr><th className="pb-3 text-left" /><th className="pb-3 text-right text-slate-500">Khách mới</th><th className="pb-3 text-right text-slate-500">Quay lại</th></tr></thead>
            <tbody className="divide-y divide-border-soft">
              <MetricComparison label="Doanh thu thuần" first={newRevenue} second={returningRevenue} money />
              <MetricComparison label="Lãi gộp" first={identifiedRows.filter((r) => r.segment === "new").reduce((s, r) => s + r.profit, 0)} second={returningProfit} money />
              <MetricComparison label="Giá trị TB/đơn" first={average(identifiedRows.filter((r) => r.segment === "new"), "averageOrder")} second={average(identifiedRows.filter((r) => r.segment === "returning"), "averageOrder")} money />
              <MetricComparison label="Biên lãi gộp" first={ratio(identifiedRows.filter((r) => r.segment === "new"))} second={ratio(identifiedRows.filter((r) => r.segment === "returning"))} />
            </tbody>
          </table>
          <LineChart rows={data.byDay} series={[{ key: "revenue", color: "#078c87" }, { key: "grossProfit", color: "#076c3b" }]} />
        </div>
      </ReportSurface>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1.2fr]">
        <InsightMetric icon={<Users />} label="Khách quay lại tạo" value={percent(repeatShare)} note="tổng lãi gộp" />
        <InsightMetric icon={<UserRound />} label="Giá trị TB/khách" value={compactMoney(averageCustomer)} />
        <InsightMetric icon={<UserRound />} label="Tần suất mua" value={frequency.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} note="đơn/khách" />
        <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-4 text-sm text-primary-800"><div className="flex items-center gap-2 font-black"><Star className="h-5 w-5 fill-primary-600 text-primary-600" /> Tỷ lệ khách quay lại đạt {percent(data.summary.customerCount === 0 ? 0 : data.summary.returningCustomerCount / data.summary.customerCount * 100)}</div><p className="mt-1 text-xs leading-relaxed">{data.summary.customerCount === 0 ? "Chưa có khách hàng định danh trong kỳ báo cáo." : "Theo dõi nhóm quay lại để tối ưu giá trị và lãi gộp mỗi khách."}</p></div>
      </div>
      <ReportSurface title="Hiệu quả khách hàng" flush>
        <ReportCustomersTable rows={rows} />
      </ReportSurface>
    </div>
  );
}

function KpiGrid({ children, mobileCarousel }: { children: React.ReactNode; mobileCarousel?: boolean }) {
  if (mobileCarousel) {
    return (
      <div>
        <div className="grid snap-x grid-flow-col auto-cols-[calc(50%-0.375rem)] grid-cols-none gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:col-span-1 lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-5 lg:overflow-visible lg:pb-0">
          {children}
        </div>
        <div className="mt-2 flex justify-center gap-1.5 lg:hidden" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-primary-700" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        </div>
      </div>
    );
  }
  return <div className="grid grid-cols-6 gap-3 lg:grid-cols-5">{children}</div>;
}

function KpiCard({ label, value, suffix, delta, featured, wideMobile, thirdMobile, point, inverse }: { label: string; value: string; suffix?: string; delta: number | null; featured?: boolean; wideMobile?: boolean; thirdMobile?: boolean; point?: boolean; inverse?: boolean }) {
  return <div className={cn("col-span-3 min-h-[112px] snap-start rounded-xl border bg-surface p-4 lg:col-span-1", featured ? "border-primary-500" : "border-border", wideMobile && "col-span-6", thirdMobile && "col-span-2 p-3 lg:p-4")}><div className="text-xs font-bold text-slate-700">{label} <span className="ml-1 text-slate-400">ⓘ</span></div><div className={cn("mt-2 font-black tabular-nums tracking-tight", featured ? "text-3xl text-primary-700" : "text-[clamp(1.3rem,2vw,1.8rem)]", thirdMobile && "text-lg lg:text-[clamp(1.3rem,2vw,1.8rem)]")}>{value}<span className="text-base">{suffix}</span></div><Delta value={delta} point={point} inverse={inverse} /></div>;
}

function Delta({ value, point, inverse }: { value: number | null; point?: boolean; inverse?: boolean }) {
  if (value == null) return <div className="mt-2 text-[10px] text-slate-400">— so với kỳ trước</div>;
  const positive = inverse ? value <= 0 : value >= 0;
  return <div data-delta className="mt-2 flex flex-wrap items-center gap-2 text-[10px]"><span className={cn("rounded-md px-1.5 py-0.5 font-black", positive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>{value >= 0 ? "↑" : "↓"} {Math.abs(value).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}{point ? " điểm %" : "%"}</span><span className="delta-context text-slate-500">so với kỳ trước</span></div>;
}

function ReportSurface({ title, subtitle, children, compact, flush }: { title: string; subtitle?: string; children: React.ReactNode; compact?: boolean; flush?: boolean }) {
  return <section className={cn("overflow-hidden rounded-xl border border-border bg-surface", !flush && (compact ? "p-3" : "p-4"))}>{flush && <div className="border-b border-border px-4 py-3 text-sm font-black">{title}</div>}{!flush && <h2 className="mb-3 text-sm font-black">{title} {subtitle && <span className="font-medium text-slate-400">({subtitle})</span>}</h2>}{children}</section>;
}

function ChartLegend({ items }: { items: [string, string, boolean?][] }) { return <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-slate-600">{items.map(([label, color, dotted]) => <span key={label} className="inline-flex items-center gap-2"><span className={cn("h-0.5 w-4", dotted && "border-t-2 border-dotted bg-transparent")} style={{ backgroundColor: dotted ? undefined : color, borderColor: color }} />{label}</span>)}</div>; }

function LineChart({ rows, previous, series, fullWidth }: { rows: ReportsData["byDay"]; previous?: ReportsData["byDay"]; series: { key: "revenue" | "grossProfit"; color: string; previousColor?: string }[]; fullWidth?: boolean }) {
  const all = [...rows, ...(previous ?? [])];
  const max = Math.max(1, ...all.flatMap((row) => series.map((item) => Math.abs(row[item.key]))));
  const points = (data: ReportsData["byDay"], key: "revenue" | "grossProfit") => data.map((row, index) => `${(index / Math.max(1, data.length - 1)) * 960 + 20},${190 - Math.max(0, row[key]) / max * 160}`).join(" ");
  return <div className="overflow-x-auto"><svg viewBox="0 0 1000 220" role="img" aria-label="Biểu đồ doanh thu và lãi gộp theo ngày" className={cn("h-48 min-w-[640px] w-full", fullWidth && "lg:aspect-[1000/220] lg:h-auto")}><g stroke="#e5e7eb" strokeWidth="1">{[30,70,110,150,190].map((y) => <line key={y} x1="20" y1={y} x2="980" y2={y} />)}</g>{previous && series.map((item) => <polyline key={`p-${item.key}`} fill="none" stroke={item.previousColor ?? item.color} strokeWidth="2" strokeDasharray="4 5" points={points(previous, item.key)} />)}{series.map((item) => <polyline key={item.key} fill="none" stroke={item.color} strokeWidth="2.5" points={points(rows, item.key)} />)}{rows.map((row, index) => <text key={row.day} x={(index / Math.max(1, rows.length - 1)) * 960 + 20} y="214" textAnchor="middle" fontSize="9" fill="#64748b">{row.day.slice(8)}</text>)}</svg></div>;
}

function OrderChart({ rows }: { rows: ReportsData["byDay"] }) {
  const maxOrders = Math.max(1, ...rows.map((row) => Math.max(row.orderCount, row.returnedOrders)));
  const maxAverage = Math.max(1, ...rows.map((row) => row.averageOrder));
  const slot = 960 / Math.max(1, rows.length);
  const barWidth = Math.min(28, slot * 0.5);
  const averagePoints = rows
    .map((row, index) => `${20 + slot * (index + 0.5)},${190 - row.averageOrder / maxAverage * 155}`)
    .join(" ");

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 1000 220"
        role="img"
        aria-label="Biểu đồ số đơn và giá trị trung bình theo ngày"
        className="h-48 min-w-[640px] w-full"
      >
        <g stroke="#e5e7eb" strokeWidth="1">
          {[35, 75, 115, 155, 190].map((y) => <line key={y} x1="20" y1={y} x2="980" y2={y} />)}
        </g>
        {rows.map((row, index) => {
          const x = 20 + slot * (index + 0.5);
          const completed = Math.max(0, row.orderCount - row.returnedOrders);
          const completedHeight = completed / maxOrders * 155;
          const returnedHeight = row.returnedOrders / maxOrders * 155;
          return (
            <g key={row.day}>
              <title>{`${row.day}: ${completed} hoàn thành, ${row.returnedOrders} hoàn trả, giá trị TB ${compactMoney(row.averageOrder)}`}</title>
              <rect x={x - barWidth / 2} y={190 - completedHeight} width={barWidth} height={completedHeight} fill="#087f69" rx="1" />
              <rect x={x - barWidth / 2} y={190 - completedHeight - returnedHeight} width={barWidth} height={returnedHeight} fill="#a7cf9a" rx="1" />
              <text x={x} y="214" textAnchor="middle" fontSize="9" fill="#64748b">{row.day.slice(8)}</text>
            </g>
          );
        })}
        <polyline fill="none" stroke="#078c87" strokeWidth="2.5" points={averagePoints} />
        {rows.map((row, index) => (
          <circle key={`average-${row.day}`} cx={20 + slot * (index + 0.5)} cy={190 - row.averageOrder / maxAverage * 155} r="3.5" fill="#078c87" stroke="white" strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  );
}

function StatusCard({ icon, label, value, color, delta, inverse }: { icon: React.ReactNode; label: string; value: number; color: string; delta: number | null; inverse?: boolean }) { return <div className="flex min-w-0 flex-col items-center gap-1 rounded-xl border border-border bg-surface p-2 text-center [&_.delta-context]:hidden lg:flex-row lg:gap-3 lg:p-3 lg:text-left"><span className={cn("[&>svg]:h-6 [&>svg]:w-6 lg:[&>svg]:h-9 lg:[&>svg]:w-9", color)}>{icon}</span><div className="min-w-0"><div className="truncate text-[10px] text-slate-500 lg:text-xs">{label}</div><div className="text-lg font-black lg:text-xl">{value}</div><Delta value={delta} inverse={inverse} /></div></div>; }

function ContributionBars({ rows }: { rows: ReportProductRow[] }) { const max = Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.profit))); return <div className="space-y-2">{rows.map((row, index) => <div key={row.productId} className="grid grid-cols-[18px_110px_1fr_54px] items-center gap-2 text-[10px]"><span>{index + 1}</span><span className="truncate">{row.productName}</span><div className="relative h-3 rounded-sm bg-slate-100"><div className="absolute inset-y-0 left-0 bg-primary-600" style={{ width: `${Math.max(0, row.revenue) / max * 100}%` }} /><div className="absolute inset-y-0 left-0 bg-emerald-800" style={{ width: `${Math.max(0, row.profit) / max * 100}%` }} /></div><span className={row.profit < 0 ? "text-red-600" : ""}>{compactMoney(row.profit)}</span></div>)}</div>; }

function ScatterChart({ rows }: { rows: ReportProductRow[] }) { const maxRevenue = Math.max(1, ...rows.map((r) => Math.abs(r.revenue))); return <svg viewBox="0 0 420 260" role="img" aria-label="Biểu đồ biên lãi theo sản phẩm" className="h-56 w-full"><line x1="35" y1="125" x2="405" y2="125" stroke="#cbd5e1"/><line x1="210" y1="15" x2="210" y2="235" stroke="#94a3b8" strokeDasharray="4 4"/>{rows.map((row) => <circle key={row.productId} cx={35 + Math.abs(row.revenue) / maxRevenue * 360} cy={125 - Math.max(-80, Math.min(80, row.margin)) / 80 * 105} r="4" fill={row.margin < 0 ? "#dc2626" : "#0f9f91"} />)}<text x="220" y="255" fontSize="10" fill="#64748b">Doanh thu thuần</text></svg>; }

function HighlightCard({ icon, title, row, value, tone }: { icon: React.ReactNode; title: string; row?: { productName: string; margin: number } | null; value: string; tone: "success" | "danger" | "warning" }) { const color = tone === "danger" ? "text-red-600 bg-red-50" : tone === "warning" ? "text-amber-600 bg-amber-50" : "text-primary-700 bg-primary-50"; return <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4"><span className={cn("grid h-10 w-10 place-items-center rounded-full [&>svg]:h-5 [&>svg]:w-5", color)}>{icon}</span><div className="min-w-0"><div className="text-xs font-black">{title}</div><div className="truncate text-xs text-slate-600">{row?.productName ?? "Chưa có dữ liệu"}</div><div className={cn("text-lg font-black", tone === "danger" && "text-red-600", tone === "success" && "text-primary-700")}>{value}</div>{row && <div className="text-[10px] text-slate-500">Biên lãi {percent(row.margin)}</div>}</div></div>; }

function InsightMetric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note?: string }) { return <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4"><span className="grid h-11 w-11 place-items-center rounded-full bg-primary-50 text-primary-700 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><div className="text-[10px] text-slate-500">{label}</div><div className="text-xl font-black text-primary-700">{value}</div>{note && <div className="text-[9px] text-slate-500">{note}</div>}</div></div>; }

function MetricComparison({ label, first, second, money }: { label: string; first: number; second: number; money?: boolean }) { return <tr><td className="py-3 text-slate-600">{label}</td><td className="py-3 text-right font-black">{money ? compactMoney(first) : percent(first)}</td><td className="py-3 text-right font-black">{money ? compactMoney(second) : percent(second)}</td></tr>; }

function average(rows: ReportCustomerRow[], key: "averageOrder") { return rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0; }
function ratio(rows: ReportCustomerRow[]) { const revenue = rows.reduce((sum, row) => sum + row.revenue, 0); return revenue === 0 ? 0 : rows.reduce((sum, row) => sum + row.profit, 0) / revenue * 100; }
function change(current: number, previous: number) { return previous === 0 ? current === 0 ? 0 : null : (current - previous) / Math.abs(previous) * 100; }
function compactMoney(value: number) { const abs = Math.abs(value); const sign = value < 0 ? "−" : ""; if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tỷ`; if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`; if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000).toLocaleString("vi-VN")} nghìn`; return formatCurrency(value); }
function percent(value: number) { return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`; }
