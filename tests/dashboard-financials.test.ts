import { describe, expect, test } from "bun:test";
import {
  calculateDashboardFinancials,
  mergeNetRevenueByDay,
} from "../src/lib/dashboard/financials";

describe("dashboard financials", () => {
  test("nets returns created in the selected range from revenue and gross profit", () => {
    expect(calculateDashboardFinancials({
      grossRevenue: 500_000,
      grossProfit: 180_000,
      refundTotal: 120_000,
      returnedProfit: 45_000,
      orderCount: 2,
    })).toEqual({
      revenue: 380_000,
      grossProfit: 135_000,
      avgOrder: 190_000,
      marginPct: 35.526315789473685,
    });
  });

  test("attributes refunds to the day the return was created", () => {
    expect(mergeNetRevenueByDay(
      [{ day: "2026-07-19", dow: 7, revenue: "500000" }],
      [
        { day: "2026-07-19", dow: 7, refund: "120000" },
        { day: "2026-07-20", dow: 1, refund: "50000" },
      ],
    )).toEqual([
      { day: "2026-07-19", dow: 7, revenue: 380_000 },
      { day: "2026-07-20", dow: 1, revenue: -50_000 },
    ]);
  });
});
