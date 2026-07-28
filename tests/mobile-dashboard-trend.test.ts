import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import enMessages from "../messages/en.json";
import viMessages from "../messages/vi.json";

const dashboardSource = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");

describe("mobile dashboard trend context", () => {
  test("renders the existing ranges as 44px snap-scrolling links", () => {
    expect(dashboardSource).toContain("snap-x snap-mandatory");
    expect(dashboardSource).toMatch(
      /RANGES\.map\(\(r\) => \([\s\S]*?href=\{`\$\{Routes\.Dashboard\}\?range=\$\{r\}`\}[\s\S]*?aria-current=\{range === r \? "page" : undefined\}[\s\S]*?min-h-11[\s\S]*?snap-start/,
    );
  });

  test("keeps today metrics separate from the selected-range revenue bars", () => {
    expect(dashboardSource).toContain('t("mobile.dashboard.todayOverview")');
    expect(dashboardSource).toContain('t("mobile.dashboard.selectedRange"');
    expect(dashboardSource).toMatch(
      /data\.revenueByDay\.map\(\(d\) => \{[\s\S]*?t\("mobile\.dashboard\.trendBarLabel"[\s\S]*?aria-label=\{label\}[\s\S]*?min-w-7/,
    );
    expect(dashboardSource).toContain("(v / maxDay) * 100");
  });

  test("provides localized labels for the range and revenue bars", () => {
    for (const messages of [viMessages, enMessages]) {
      expect(messages.mobile.dashboard.rangeLabel).toBeTruthy();
      expect(messages.mobile.dashboard.todayOverview).toBeTruthy();
      expect(messages.mobile.dashboard.revenueTrend).toBeTruthy();
      expect(messages.mobile.dashboard.selectedRange).toContain("{range}");
      expect(messages.mobile.dashboard.trendBarLabel).toContain("{date}");
      expect(messages.mobile.dashboard.trendBarLabel).toContain("{revenue}");
    }
  });
});
