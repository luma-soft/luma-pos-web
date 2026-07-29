import { describe, expect, test } from "bun:test";
import { resolveDashboardRange, type DashboardRange } from "@/lib/dashboard/range";

describe("resolveDashboardRange", () => {
  test("defaults a missing or unsupported range to today", () => {
    expect(resolveDashboardRange(undefined)).toBe("today");
    expect(resolveDashboardRange("quarter")).toBe("today");
  });

  test.each(["today", "7d", "30d", "month"] as const)(
    "preserves the supported %s range",
    (range: DashboardRange) => {
      expect(resolveDashboardRange(range)).toBe(range);
    },
  );
});
