export type DashboardFinancialInput = {
  grossRevenue: number;
  grossProfit: number;
  refundTotal: number;
  returnedProfit: number;
  orderCount: number;
};

export type DashboardFinancials = {
  revenue: number;
  grossProfit: number;
  avgOrder: number;
  marginPct: number;
};

export function calculateDashboardFinancials(
  input: DashboardFinancialInput,
): DashboardFinancials {
  const revenue = input.grossRevenue - input.refundTotal;
  const grossProfit = input.grossProfit - input.returnedProfit;

  return {
    revenue,
    grossProfit,
    avgOrder: input.orderCount > 0 ? revenue / input.orderCount : 0,
    marginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
  };
}

type RevenueDay = {
  day: string;
  dow: number;
  revenue: string | number;
};

type RefundDay = {
  day: string;
  dow: number;
  refund: string | number;
};

export function mergeNetRevenueByDay(
  sales: RevenueDay[],
  refunds: RefundDay[],
): Array<{ day: string; dow: number; revenue: number }> {
  const days = new Map<string, { day: string; dow: number; revenue: number }>();

  for (const sale of sales) {
    days.set(sale.day, {
      day: sale.day,
      dow: sale.dow,
      revenue: Number(sale.revenue),
    });
  }
  for (const refund of refunds) {
    const current = days.get(refund.day);
    days.set(refund.day, {
      day: refund.day,
      dow: refund.dow,
      revenue: (current?.revenue ?? 0) - Number(refund.refund),
    });
  }

  return [...days.values()].sort((left, right) => left.day.localeCompare(right.day));
}
