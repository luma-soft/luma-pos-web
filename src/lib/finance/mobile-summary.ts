export type MobileFinanceSummaryInput = {
  revenue: number;
  grossProfit: number;
  collected: number;
  debt: number;
};

export function buildMobileFinanceSummary(input: MobileFinanceSummaryInput) {
  return {
    revenue: input.revenue,
    collected: input.collected,
    estimatedProfit: input.grossProfit,
    cost: Math.max(0, input.revenue - input.grossProfit),
    debt: input.debt,
  };
}
