import { describe, expect, test } from "bun:test";
import { currentDeclarationPeriod, occurrenceDeclarationPeriod } from "./declaration-period.ts";

const now = new Date(2026, 8, 11, 12);

describe("currentDeclarationPeriod", () => {
  test("resolves monthly and quarterly periods", () => {
    expect(currentDeclarationPeriod("monthly", now)?.periodKey).toBe("2026-09");
    expect(currentDeclarationPeriod("quarterly", now)?.periodKey).toBe("2026-Q3");
  });

  test("resolves annual period", () => {
    expect(currentDeclarationPeriod("annual", now)?.periodKey).toBe("2026");
  });

  test("does not invent a period for per-occurrence or unconfigured filing", () => {
    expect(currentDeclarationPeriod("per_occurrence", now)).toBeNull();
    expect(currentDeclarationPeriod("unconfigured", now)).toBeNull();
  });

  test("creates a bounded per-occurrence day only from a valid selected date", () => {
    const period = occurrenceDeclarationPeriod("2026-09-11");
    expect(period?.periodType).toBe("per_occurrence");
    expect(period?.periodKey).toBe("2026-09-11");
    expect(occurrenceDeclarationPeriod("2026-02-31")).toBeNull();
  });
});
