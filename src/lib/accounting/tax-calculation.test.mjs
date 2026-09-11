import { describe, expect, test } from "bun:test";
import { calculateRevenuePercentageTaxes, calculateTaxableIncomeTaxes } from "./tax-calculation.ts";

const rows = [
  { activityId: "goods", activityName: "Phân phối hàng hóa", revenue: 100_000_000, vatRate: 1, pitRate: 0.5 },
  { activityId: "services", activityName: "Dịch vụ", revenue: 20_000_000, vatRate: 5, pitRate: 2 },
];

describe("tax declaration calculations", () => {
  test("calculates each activity before summing percentage-on-revenue taxes", () => {
    expect(calculateRevenuePercentageTaxes(rows)).toMatchObject({ revenue: 120_000_000, vatAmount: 2_000_000, pitAmount: 900_000 });
  });

  test("reduces only VAT when the direct-tax reduction is enabled", () => {
    expect(calculateRevenuePercentageTaxes(rows, { reduceVatByPercent: 20 })).toMatchObject({
      revenue: 120_000_000,
      vatAmount: 1_600_000,
      pitAmount: 900_000,
    });
  });

  test("never produces negative taxable income", () => {
    expect(calculateTaxableIncomeTaxes(rows, 140_000_000)).toMatchObject({ taxableIncome: 0, pitAmount: 0 });
  });
});
