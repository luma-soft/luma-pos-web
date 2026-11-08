import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./report-period-filter.tsx", import.meta.url), "utf8");
test("native Mobile report range is draft-only until Apply", () => {
  expect(src).toContain("setDraftPeriod(period)");
  expect(src).toContain('onClick={() => setDraftPeriod(option)}');
  expect(src).toContain("onClick={applyMobileRange}");
  expect(src).toContain("navigate(draftPeriod, customFrom, customTo)");
  expect(src).toContain('size="full"');
  expect(src).toContain('panelClassName="lg:hidden"');
});
test("all iOS period options and custom validation stay available", () => {
  for (const value of ['"today"', '"week"', '"7d"', '"30d"', '"90d"', '"this_month"', '"last_month"', '"this_year"', '"custom"']) {
    expect(src).toContain(value);
  }
  expect(src).toContain("customFrom > customTo");
  expect(src).toContain("disabled={draftPeriod === \"custom\"");
  expect(src).toContain('<ReportPeriodSelect period={period}');
  expect(src).toContain('open={dateModalOpen}');
});
