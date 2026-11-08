import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const filter = readFileSync(new URL("./report-period-filter.tsx", import.meta.url), "utf8");
test("iOS reports week starts Monday and is mobile-only preset", () => {
  expect(page).toContain('period === "week"');
  expect(page).toContain("today.getDay() + 6");
  expect(filter).toContain('const periods = ["today", "week", "this_month", "custom"]');
  expect(filter).toContain('PERIODS.filter((value) => value !== "week")');
});
test("report backend range selection still preserves original 7/30/90 and custom", () => {
  expect(page).toContain('else if (period === "7d")');
  expect(page).toContain('else if (period === "30d")');
  expect(page).toContain('else if (period === "90d")');
  expect(page).toContain('else if (period === "custom")');
});
