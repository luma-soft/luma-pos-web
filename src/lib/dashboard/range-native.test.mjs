import { expect, test } from "bun:test";
import { resolveDashboardRange } from "./range.ts";
import { readFileSync } from "node:fs";
const page = readFileSync(new URL("../../app/(app)/dashboard/page.tsx", import.meta.url), "utf8");
const data = readFileSync(new URL("../data/dashboard.ts", import.meta.url), "utf8");
test("old and native presets coexist", () => {
  for (const r of ["today","7d","30d","week","month","year"]) expect(resolveDashboardRange(r)).toBe(r);
  expect(resolveDashboardRange("bad")).toBe("today");
  expect(page).toContain('const MOBILE_RANGES: DashboardRange[] = ["today", "week", "month", "year"]');
  expect(page).toContain('const RANGES: DashboardRange[] = ["today", "7d", "30d", "month"]');
  expect(page.match(/await getDashboard\(/g)?.length).toBe(1);
  expect(data).toContain('range === "week"');
  expect(data).toContain('range === "year"');
});
