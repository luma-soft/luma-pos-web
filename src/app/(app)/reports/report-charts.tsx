"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { bucketReportDays, type ReportBucket, type ReportDay } from "./report-buckets";
import { useReportFormat } from "./report-format";

const W = 1000;
const H = 240;
const PAD = { left: 64, right: 12, top: 12, bottom: 30 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const MAX_X_LABELS = 12;

type SeriesKey = "revenue" | "grossProfit";
type Granularity = ReturnType<typeof bucketReportDays>["granularity"];

function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
}

/** Y domain that starts at (or below) zero with four round ticks above. */
function yScale(values: number[]) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const step = niceStep((max - min) / 4 || 1);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const bottom = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = bottom; value <= top + step / 2; value += step) ticks.push(value);
  const y = (value: number) => PAD.top + (top - value) / (top - bottom || 1) * PLOT_H;
  return { ticks, y };
}

function useBucketLabels(granularity: Granularity) {
  const format = useReportFormat();
  const monthLabel = (key: string) => `${key.slice(5, 7)}/${key.slice(0, 4)}`;
  return {
    ...format,
    axis: (bucket: ReportBucket) => granularity === "month" ? monthLabel(bucket.from) : format.date(bucket.from),
    title: (bucket: ReportBucket) => {
      if (granularity === "day") return format.date(bucket.from, true);
      if (granularity === "week") return format.t("chart.weekOf", { from: format.date(bucket.from), to: format.date(bucket.to, true) });
      return format.t("chart.monthOf", { month: monthLabel(bucket.from) });
    },
  };
}

/** Pointer → nearest bucket index, shared by both charts. */
function useHoverIndex(count: number, xOf: (index: number) => number) {
  const [index, setIndex] = useState<number | null>(null);
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (count === 0 || rect.width === 0) return;
    const x = (event.clientX - rect.left) / rect.width * W;
    let nearest = 0;
    for (let candidate = 1; candidate < count; candidate += 1) {
      if (Math.abs(xOf(candidate) - x) < Math.abs(xOf(nearest) - x)) nearest = candidate;
    }
    setIndex(nearest);
  };
  return { index, onPointerMove, onPointerLeave: () => setIndex(null) };
}

function XLabels({ buckets, xOf, label }: { buckets: ReportBucket[]; xOf: (index: number) => number; label: (bucket: ReportBucket) => string }) {
  const every = Math.max(1, Math.ceil(buckets.length / MAX_X_LABELS));
  return (
    <g fontSize="11" fill="#64748b">
      {buckets.map((bucket, index) => index % every === 0 && (
        <text key={bucket.from} x={xOf(index)} y={H - 8} textAnchor="middle">{label(bucket)}</text>
      ))}
    </g>
  );
}

function YAxis({ ticks, y, format }: { ticks: number[]; y: (value: number) => number; format: (value: number) => string }) {
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#cbd5e1" : "#e5e7eb"} strokeWidth="1" />
          <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#64748b">{format(tick)}</text>
        </g>
      ))}
    </g>
  );
}

function Tooltip({ x, title, rows }: { x: number; title: string; rows: { label: string; value: string; color: string; dashed?: boolean }[] }) {
  const ratio = x / W;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left: `${ratio * 100}%`, transform: `translateX(${ratio > 0.6 ? "calc(-100% - 12px)" : "12px"})` }}
    >
      <div className="mb-1 font-black">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <span className={cn("h-0.5 w-3", row.dashed && "border-t-2 border-dotted bg-transparent")} style={{ backgroundColor: row.dashed ? undefined : row.color, borderColor: row.color }} />
            {row.label}
          </span>
          <span className="font-bold tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportChartTitle({ rows, kind }: { rows: ReportDay[]; kind: "trend" | "orderChart" }) {
  const { t } = useReportFormat();
  const { granularity } = bucketReportDays(rows);
  return <>{t(`${kind}.${granularity}`)}</>;
}

export function TrendChart({ rows, previous, series }: {
  rows: ReportDay[];
  previous?: ReportDay[];
  series: { key: SeriesKey; label: string; color: string; previousLabel?: string; previousColor?: string }[];
}) {
  const { granularity, current, previous: previousBuckets } = bucketReportDays(rows, previous);
  const labels = useBucketLabels(granularity);
  const values = [...current, ...previousBuckets].flatMap((bucket) => series.map((item) => bucket[item.key]));
  const { ticks, y } = yScale(values);
  const xOf = (index: number) => PAD.left + (current.length <= 1 ? PLOT_W / 2 : index / (current.length - 1) * PLOT_W);
  const hover = useHoverIndex(current.length, xOf);
  const path = (buckets: ReportBucket[], key: SeriesKey) => buckets.map((bucket, index) => `${xOf(index)},${y(bucket[key])}`).join(" ");
  const active = hover.index == null ? null : current[hover.index];

  return (
    <div className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={labels.t("trend.aria")}
        className="h-56 min-w-[640px] w-full touch-pan-x lg:aspect-[1000/240] lg:h-auto"
        onPointerMove={hover.onPointerMove}
        onPointerLeave={hover.onPointerLeave}
      >
        <YAxis ticks={ticks} y={y} format={labels.money} />
        {previousBuckets.length > 0 && series.map((item) => item.previousColor && (
          <polyline key={`p-${item.key}`} fill="none" stroke={item.previousColor} strokeWidth="2" strokeDasharray="4 5" points={path(previousBuckets, item.key)} />
        ))}
        {series.map((item) => <polyline key={item.key} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" points={path(current, item.key)} />)}
        {current.length === 1 && series.map((item) => <circle key={`dot-${item.key}`} cx={xOf(0)} cy={y(current[0][item.key])} r="4.5" fill={item.color} stroke="white" strokeWidth="1.5" />)}
        {hover.index != null && active && (
          <g>
            <line x1={xOf(hover.index)} x2={xOf(hover.index)} y1={PAD.top} y2={PAD.top + PLOT_H} stroke="#94a3b8" strokeDasharray="3 3" />
            {series.map((item) => <circle key={`h-${item.key}`} cx={xOf(hover.index!)} cy={y(active[item.key])} r="4" fill={item.color} stroke="white" strokeWidth="1.5" />)}
          </g>
        )}
        <XLabels buckets={current} xOf={xOf} label={labels.axis} />
      </svg>
      {hover.index != null && active && (
        <Tooltip
          x={xOf(hover.index)}
          title={labels.title(active)}
          rows={[
            ...series.map((item) => ({ label: item.label, value: labels.money(active[item.key]), color: item.color })),
            ...(previousBuckets[hover.index] ? series.filter((item) => item.previousColor).map((item) => ({
              label: item.previousLabel ?? item.label,
              value: labels.money(previousBuckets[hover.index!][item.key]),
              color: item.previousColor!,
              dashed: true,
            })) : []),
          ]}
        />
      )}
    </div>
  );
}

export function OrderTrendChart({ rows }: { rows: ReportDay[] }) {
  const { granularity, current } = bucketReportDays(rows);
  const labels = useBucketLabels(granularity);
  const orders = yScale(current.map((bucket) => bucket.orderCount));
  const maxAverage = Math.max(1, ...current.map((bucket) => bucket.averageOrder));
  const averageY = (value: number) => PAD.top + PLOT_H - value / maxAverage * PLOT_H * 0.95;
  const slot = PLOT_W / Math.max(1, current.length);
  const barWidth = Math.max(2, Math.min(28, slot * 0.55));
  const xOf = (index: number) => PAD.left + slot * (index + 0.5);
  const hover = useHoverIndex(current.length, xOf);
  const active = hover.index == null ? null : current[hover.index];

  return (
    <div className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={labels.t("orderChart.aria")}
        className="h-56 min-w-[640px] w-full touch-pan-x"
        onPointerMove={hover.onPointerMove}
        onPointerLeave={hover.onPointerLeave}
      >
        <YAxis ticks={orders.ticks} y={orders.y} format={(value) => labels.number(value, 0)} />
        {hover.index != null && <rect x={xOf(hover.index) - slot / 2} y={PAD.top} width={slot} height={PLOT_H} fill="#f1f5f9" />}
        {current.map((bucket, index) => {
          const completed = Math.max(0, bucket.orderCount - bucket.returnedOrders);
          const base = orders.y(0);
          const completedTop = orders.y(completed);
          const returnedTop = orders.y(completed + bucket.returnedOrders);
          return (
            <g key={bucket.from}>
              <rect x={xOf(index) - barWidth / 2} y={completedTop} width={barWidth} height={base - completedTop} fill="#087f69" rx="1" />
              <rect x={xOf(index) - barWidth / 2} y={returnedTop} width={barWidth} height={completedTop - returnedTop} fill="#a7cf9a" rx="1" />
            </g>
          );
        })}
        <polyline fill="none" stroke="#078c87" strokeWidth="2.5" strokeLinejoin="round" points={current.map((bucket, index) => `${xOf(index)},${averageY(bucket.averageOrder)}`).join(" ")} />
        {current.length <= 62 && current.map((bucket, index) => (
          <circle key={`a-${bucket.from}`} cx={xOf(index)} cy={averageY(bucket.averageOrder)} r="3" fill="#078c87" stroke="white" strokeWidth="1.5" />
        ))}
        <XLabels buckets={current} xOf={xOf} label={labels.axis} />
      </svg>
      {hover.index != null && active && (
        <Tooltip
          x={xOf(hover.index)}
          title={labels.title(active)}
          rows={[
            { label: labels.t("orderChart.completed"), value: labels.number(Math.max(0, active.orderCount - active.returnedOrders), 0), color: "#087f69" },
            { label: labels.t("orderChart.returned"), value: labels.number(active.returnedOrders, 0), color: "#a7cf9a" },
            { label: labels.t("orderChart.avg"), value: labels.money(active.averageOrder), color: "#078c87" },
          ]}
        />
      )}
    </div>
  );
}

/** Phones: horizontally scrolling KPI tiles with page dots that follow the scroll. */
export function KpiCarousel({ children, count }: { children: React.ReactNode; count: number }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, count - 1);
  return (
    <div>
      <div
        onScroll={(event) => {
          const element = event.currentTarget;
          const max = element.scrollWidth - element.clientWidth;
          setPage(max <= 0 ? 0 : Math.round(element.scrollLeft / max * (pages - 1)));
        }}
        className="grid snap-x grid-flow-col auto-cols-[calc(50%-0.375rem)] grid-cols-none gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:col-span-1 lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-5 lg:overflow-visible lg:pb-0"
      >
        {children}
      </div>
      <div className="mt-2 flex justify-center gap-1.5 lg:hidden" aria-hidden="true">
        {Array.from({ length: pages }, (_, index) => (
          <span key={index} className={cn("h-1.5 w-1.5 rounded-full transition-colors", index === page ? "bg-primary-700" : "bg-slate-300")} />
        ))}
      </div>
    </div>
  );
}
