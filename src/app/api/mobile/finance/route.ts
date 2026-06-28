import { and, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { cashTransactions, orders, purchaseOrders } from "@/db/schema";
import { getReports } from "@/lib/data/reports";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, searchParam } from "@/lib/mobile/response";

function sinceForRange(range?: string) {
  const days = range === "today" ? 1 : range === "week" ? 7 : 30;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d;
}

export async function GET(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const range = searchParam(request, "range", "month");
  const since = sinceForRange(range);
  const saleStatus = inArray(orders.status, ["completed", "returned"]);
  const payableStatus = inArray(purchaseOrders.status, ["received", "returned"]);

  const [reports, receivableRows, payableRows, cashRows] = await Promise.all([
    getReports(range === "today" ? 1 : range === "week" ? 7 : 30),
    db
      .select({
        total: sql<string>`coalesce(sum(${orders.total}), 0)`,
        paid: sql<string>`coalesce(sum(${orders.amountPaid}), 0)`,
        unpaid: sql<string>`coalesce(sum(greatest(${orders.total} - ${orders.amountPaid}, 0)), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(saleStatus, gte(orders.createdAt, since))),
    db
      .select({
        total: sql<string>`coalesce(sum(${purchaseOrders.total}), 0)`,
        paid: sql<string>`coalesce(sum(${purchaseOrders.amountPaid}), 0)`,
        unpaid: sql<string>`coalesce(sum(greatest(${purchaseOrders.total} - ${purchaseOrders.amountPaid}, 0)), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(purchaseOrders)
      .where(and(payableStatus, gte(purchaseOrders.createdAt, since))),
    db
      .select({
        fund: cashTransactions.fund,
        totalIn: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'in'), 0)`,
        totalOut: sql<string>`coalesce(sum(${cashTransactions.amount}) filter (where ${cashTransactions.type} = 'out'), 0)`,
      })
      .from(cashTransactions)
      .where(gte(cashTransactions.createdAt, since))
      .groupBy(cashTransactions.fund),
  ]);

  const receivables = receivableRows[0];
  const payables = payableRows[0];
  const cashByFund = Object.fromEntries(cashRows.map((row) => [row.fund, row]));

  return mobileOk({
    range,
    summary: {
      revenue: reports.summary.revenue,
      collected: reports.summary.collected,
      estimatedProfit: reports.topProducts.reduce(
        (sum, product) => sum + Number(product.profit ?? 0),
        0,
      ),
      cost: Math.max(
        0,
        reports.summary.revenue -
          reports.topProducts.reduce(
            (sum, product) => sum + Number(product.profit ?? 0),
            0,
          ),
      ),
      debt: Number(receivables.unpaid),
    },
    receivables: {
      total: Number(receivables.total),
      paid: Number(receivables.paid),
      unpaid: Number(receivables.unpaid),
      count: receivables.count,
    },
    payables: {
      total: Number(payables.total),
      paid: Number(payables.paid),
      unpaid: Number(payables.unpaid),
      count: payables.count,
    },
    cashMovement: {
      cash: {
        in: Number(cashByFund.cash?.totalIn ?? 0),
        out: Number(cashByFund.cash?.totalOut ?? 0),
      },
      bank: {
        in: Number(cashByFund.bank?.totalIn ?? 0),
        out: Number(cashByFund.bank?.totalOut ?? 0),
      },
    },
    topProducts: reports.topProducts,
    topCustomers: reports.byCustomer,
  });
}
