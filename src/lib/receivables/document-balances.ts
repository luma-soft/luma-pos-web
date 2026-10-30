import { and, eq, inArray } from "drizzle-orm";
import { customerReceivableEntries, returns } from "@/db/schema";
import { reconcileDebtDocuments } from "@/lib/debt-reconciliation";

// Drizzle's database and transaction objects share the same select API here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = any;

type CustomerInvoice = {
  id: string;
  createdAt: Date;
  total: string | number;
  amountPaid: string | number;
};

const money = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;

export async function getEffectiveCustomerInvoices<T extends CustomerInvoice>(
  database: DbLike,
  input: { storeId: string; customerId: string; currentDebt: number },
  invoices: T[],
) {
  if (invoices.length === 0) return [] as Array<T & { remaining: number }>;
  const orderIds = invoices.map((invoice) => invoice.id);
  const [entries, debtReturns] = await Promise.all([
    database.select({ orderId: customerReceivableEntries.orderId, amount: customerReceivableEntries.amount })
      .from(customerReceivableEntries)
      .where(and(
        eq(customerReceivableEntries.storeId, input.storeId),
        eq(customerReceivableEntries.customerId, input.customerId),
        inArray(customerReceivableEntries.orderId, orderIds),
      )),
    database.select({ orderId: returns.orderId, amount: returns.totalRefund })
      .from(returns)
      .where(and(
        eq(returns.storeId, input.storeId),
        eq(returns.customerId, input.customerId),
        eq(returns.status, "completed"),
        eq(returns.refundMethod, "debt_deduct"),
        inArray(returns.orderId, orderIds),
      )),
  ]);

  const linkedAdjustments = new Map<string, number>();
  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.orderId) {
      linkedAdjustments.set(entry.orderId, money((linkedAdjustments.get(entry.orderId) ?? 0) + amount));
    }
  }
  const returnedDebtByOrder = new Map<string, number>();
  for (const debtReturn of debtReturns) {
    if (debtReturn.orderId) {
      returnedDebtByOrder.set(
        debtReturn.orderId,
        money((returnedDebtByOrder.get(debtReturn.orderId) ?? 0) + Number(debtReturn.amount)),
      );
    }
  }

  const balances = invoices.map((invoice) => ({
    ...invoice,
    remaining: money(Math.max(
      0,
      Number(invoice.total) - Number(invoice.amountPaid) +
        (linkedAdjustments.get(invoice.id) ?? 0) - (returnedDebtByOrder.get(invoice.id) ?? 0),
    )),
  }));
  return reconcileDebtDocuments(balances, input.currentDebt);
}
