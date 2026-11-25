import { expect, test } from "bun:test";
import { granularityForDays, resolveReportRange } from "./period.ts";

// 2026-11-25 00:30 in Vietnam is still 2026-11-24 in UTC.
const earlyMorningVn = new Date("2026-11-24T17:30:00Z");

test("today follows the Vietnam business day, not UTC", () => {
  const range = resolveReportRange("today", null, null, earlyMorningVn);
  expect(range.fromValue).toBe("2026-11-25");
  expect(range.toValue).toBe("2026-11-25");
  expect(range.from.toISOString()).toBe("2026-11-24T17:00:00.000Z");
  expect(range.toExclusive.toISOString()).toBe("2026-11-25T17:00:00.000Z");
  expect(range.rangeDays).toBe(1);
});

test("week starts Monday; last month and year boundaries", () => {
  expect(resolveReportRange("week", null, null, earlyMorningVn).fromValue).toBe("2026-11-23");
  const lastMonth = resolveReportRange("last_month", null, null, new Date("2026-01-10T05:00:00Z"));
  expect([lastMonth.fromValue, lastMonth.toValue]).toEqual(["2025-12-01", "2025-12-31"]);
  expect(resolveReportRange("this_year", null, null, earlyMorningVn).fromValue).toBe("2026-01-01");
});

test("custom range is inclusive and rejects invalid dates", () => {
  const custom = resolveReportRange("custom", "2026-11-01", "2026-11-20", earlyMorningVn);
  expect(custom.rangeDays).toBe(20);
  expect(custom.toValue).toBe("2026-11-20");
  const invalid = resolveReportRange("custom", "2026-02-30", "2026-03-01", earlyMorningVn);
  expect(invalid.fromValue).toBe("2026-11-01");
});

test("long ranges group by week then month", () => {
  expect(granularityForDays(31)).toBe("day");
  expect(granularityForDays(90)).toBe("week");
  expect(granularityForDays(400)).toBe("month");
});
