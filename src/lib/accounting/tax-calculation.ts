export type TaxActivityRevenue = {
  activityId: string | null;
  activityName: string;
  revenue: number;
  vatRate: number;
  pitRate: number;
};

export function calculateRevenuePercentageTaxes(
  rows: TaxActivityRevenue[],
  options: { reduceVatByPercent?: number } = {},
) {
  const reductionMultiplier = 1 - Math.min(100, Math.max(0, options.reduceVatByPercent ?? 0)) / 100;
  const groups = rows.map((row) => ({
    ...row,
    vatAmount: roundMoney(row.revenue * row.vatRate / 100 * reductionMultiplier),
    pitAmount: roundMoney(row.revenue * row.pitRate / 100),
  }));
  return {
    groups,
    revenue: roundMoney(groups.reduce((sum, row) => sum + row.revenue, 0)),
    vatAmount: roundMoney(groups.reduce((sum, row) => sum + row.vatAmount, 0)),
    pitAmount: roundMoney(groups.reduce((sum, row) => sum + row.pitAmount, 0)),
  };
}

export function calculateTaxableIncomeTaxes(rows: TaxActivityRevenue[], deductibleExpenses: number, options: { reduceVatByPercent?: number } = {}) {
  const revenueTaxes = calculateRevenuePercentageTaxes(rows, options);
  const taxableIncome = Math.max(0, roundMoney(revenueTaxes.revenue - deductibleExpenses));
  const weightedPitRate = revenueTaxes.revenue > 0
    ? rows.reduce((sum, row) => sum + row.revenue * row.pitRate, 0) / revenueTaxes.revenue
    : 0;
  return {
    ...revenueTaxes,
    deductibleExpenses: roundMoney(deductibleExpenses),
    taxableIncome,
    pitAmount: roundMoney(taxableIncome * weightedPitRate / 100),
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
