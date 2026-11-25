import { expect, test } from "bun:test";
import { bucketReportDays } from "./report-buckets.ts";
import { toCsv } from "./export/csv.ts";

const day = (key, revenue) => ({ day: key, revenue, grossProfit: revenue / 2, costOfGoods: 0, refundTotal: 0, orderCount: 1, returnedOrders: 0, averageOrder: revenue });
const days = (start, count, revenue = 10) => Array.from({ length: count }, (_, index) => {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return day(date.toISOString().slice(0, 10), revenue);
});

test("short periods stay daily", () => {
  const result = bucketReportDays(days("2026-11-01", 20));
  expect(result.granularity).toBe("day");
  expect(result.current).toHaveLength(20);
});

test("90 days group into 7-day buckets aligned with the previous period", () => {
  const result = bucketReportDays(days("2026-08-28", 90), days("2026-05-30", 90, 5));
  expect(result.granularity).toBe("week");
  expect(result.current).toHaveLength(13);
  expect(result.current[0]).toMatchObject({ from: "2026-08-28", to: "2026-09-03", revenue: 70, orderCount: 7, averageOrder: 10 });
  expect(result.previous[0]).toMatchObject({ from: "2026-05-30", revenue: 35 });
  expect(result.current.at(-1)?.orderCount).toBe(6);
});

test("a year groups by calendar month", () => {
  const result = bucketReportDays(days("2025-11-01", 400));
  expect(result.granularity).toBe("month");
  expect(result.current[0]).toMatchObject({ from: "2025-11-01", to: "2025-11-30", orderCount: 30 });
});

test("CSV escapes quotes and blocks formulas", () => {
  expect(toCsv(["a", "b"], [['x,"y"', "=SUM(A1)"], [1, null]])).toBe('﻿a,b\r\n"x,""y""",\'=SUM(A1)\r\n1,\r\n');
});
