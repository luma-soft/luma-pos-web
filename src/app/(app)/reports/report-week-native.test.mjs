import { readSource } from "../../../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const period = readSource("../../../lib/reports/period.ts", import.meta.url);
const filter = readSource("./report-period-filter.tsx", import.meta.url);
test("iOS reports week starts Monday and is mobile-only preset", () => {
  expect(period).toContain('period === "week"');
  expect(period).toContain("(weekday + 6) % 7");
  expect(filter).toContain('const periods = ["today", "week", "this_month", "custom"]');
  expect(filter).toContain('PERIODS.filter((value) => value !== "week")');
});
test("report backend range selection still preserves original 7/30/90 and custom", () => {
  expect(period).toContain('else if (period === "7d")');
  expect(period).toContain('else if (period === "30d")');
  expect(period).toContain('else if (period === "90d")');
  expect(period).toContain('else if (period === "custom"');
});
