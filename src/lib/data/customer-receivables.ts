import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerReceivableEntries, customerReceivableReceipts, customers, orders } from "@/db/schema";

export async function getCustomerReceivableOverview(storeId: string, customerId: string) {
  const [customer] = await db.select({ id: customers.id, currentDebt: customers.currentDebt })
    .from(customers).where(and(eq(customers.storeId, storeId), eq(customers.id, customerId))).limit(1);
  if (!customer) return null;
  const [invoices, entries, receipts] = await Promise.all([
    db.select({
      id: orders.id, code: orders.code, createdAt: orders.createdAt,
      total: orders.total, amountPaid: orders.amountPaid, paymentStatus: orders.paymentStatus,
    }).from(orders).where(and(
      eq(orders.customerId, customerId),
      eq(orders.storeId, storeId),
      sql`${orders.status} in ('completed', 'returned')`,
      sql`${orders.amountPaid} < ${orders.total}`,
    )).orderBy(orders.createdAt),
    db.select({
      id: customerReceivableEntries.id, code: customerReceivableEntries.code,
      type: customerReceivableEntries.type, amount: customerReceivableEntries.amount,
      reason: customerReceivableEntries.reason, orderId: customerReceivableEntries.orderId,
      createdAt: customerReceivableEntries.createdAt,
    }).from(customerReceivableEntries).where(and(eq(customerReceivableEntries.storeId, storeId), eq(customerReceivableEntries.customerId, customerId)))
      .orderBy(desc(customerReceivableEntries.createdAt)).limit(50),
    db.select({
      id: customerReceivableReceipts.id, code: customerReceivableReceipts.code,
      status: customerReceivableReceipts.status, amount: customerReceivableReceipts.amount,
      method: customerReceivableReceipts.method, reference: customerReceivableReceipts.reference,
      createdAt: customerReceivableReceipts.createdAt,
    }).from(customerReceivableReceipts).where(and(eq(customerReceivableReceipts.storeId, storeId), eq(customerReceivableReceipts.customerId, customerId)))
      .orderBy(desc(customerReceivableReceipts.createdAt)).limit(50),
  ]);
  return {
    customerId: customer.id,
    currentDebt: Number(customer.currentDebt),
    invoices: invoices.map((invoice) => ({ ...invoice, total: Number(invoice.total), amountPaid: Number(invoice.amountPaid), remaining: Number(invoice.total) - Number(invoice.amountPaid) })),
    entries: entries.map((entry) => ({ ...entry, amount: Number(entry.amount) })),
    receipts: receipts.map((receipt) => ({ ...receipt, amount: Number(receipt.amount) })),
  };
}
