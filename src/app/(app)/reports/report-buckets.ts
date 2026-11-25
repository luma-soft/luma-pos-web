import { granularityForDays, type ReportGranularity } from "@/lib/reports/period";

export type ReportDay = {
  day: string;
  revenue: number;
  grossProfit: number;
  costOfGoods: number;
  refundTotal: number;
  orderCount: number;
  returnedOrders: number;
  averageOrder: number;
};

export type ReportBucket = ReportDay & {
  /** First and last business day (yyyy-MM-dd) in the bucket. */
  from: string;
  to: string;
};

/** Index ranges [start, end) of `days` for each bucket of the given size. */
function bucketRanges(days: string[], granularity: ReportGranularity) {
  const ranges: [number, number][] = [];
  if (granularity === "day") return days.map((_, index) => [index, index + 1] as [number, number]);
  if (granularity === "week") {
    for (let start = 0; start < days.length; start += 7) ranges.push([start, Math.min(days.length, start + 7)]);
    return ranges;
  }
  let start = 0;
  for (let index = 1; index <= days.length; index += 1) {
    if (index === days.length || days[index].slice(0, 7) !== days[start].slice(0, 7)) {
      ranges.push([start, index]);
      start = index;
    }
  }
  return ranges;
}

function sumBucket(rows: ReportDay[], fallbackDay: string): ReportBucket {
  const total = rows.reduce((sum, row) => ({
    revenue: sum.revenue + row.revenue,
    grossProfit: sum.grossProfit + row.grossProfit,
    costOfGoods: sum.costOfGoods + row.costOfGoods,
    refundTotal: sum.refundTotal + row.refundTotal,
    orderCount: sum.orderCount + row.orderCount,
    returnedOrders: sum.returnedOrders + row.returnedOrders,
  }), { revenue: 0, grossProfit: 0, costOfGoods: 0, refundTotal: 0, orderCount: 0, returnedOrders: 0 });
  const from = rows[0]?.day ?? fallbackDay;
  return {
    ...total,
    day: from,
    from,
    to: rows.at(-1)?.day ?? fallbackDay,
    averageOrder: total.orderCount === 0 ? 0 : total.revenue / total.orderCount,
  };
}

/**
 * Group daily rows into day/week/month buckets. The previous period is grouped
 * with the current period's index ranges so bucket N of both periods covers the
 * same position in its period (week 1 vs week 1, not calendar-aligned).
 */
export function bucketReportDays(rows: ReportDay[], previous: ReportDay[] = []) {
  const granularity = granularityForDays(rows.length);
  const ranges = bucketRanges(rows.map((row) => row.day), granularity);
  return {
    granularity,
    current: ranges.map(([start, end]) => sumBucket(rows.slice(start, end), rows[start]?.day ?? "")),
    previous: previous.length === 0 ? [] : ranges.map(([start, end]) => sumBucket(previous.slice(start, end), previous[Math.min(start, previous.length - 1)]?.day ?? "")),
  };
}
