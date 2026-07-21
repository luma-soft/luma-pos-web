import { describe, expect, test } from "bun:test";
import { buildMobileFinanceSummary } from "../src/lib/finance/mobile-summary";

describe("mobile finance summary", () => {
  test("uses the complete report gross profit instead of a top-product subset", () => {
    expect(buildMobileFinanceSummary({
      revenue: 1_000_000,
      grossProfit: 320_000,
      collected: 800_000,
      debt: 200_000,
    })).toEqual({
      revenue: 1_000_000,
      collected: 800_000,
      estimatedProfit: 320_000,
      cost: 680_000,
      debt: 200_000,
    });
  });
});
