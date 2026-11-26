import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, einvoices, orders, returnItems, returns } from "@/db/schema";

/**
 * Queries the web pages used to run inline. They live here so pages reach the
 * database only through data modules (served by the backend over RPC).
 */

/** Latest e-invoices of the store with their order, for the e-invoice queue tab. */
export async function getEInvoiceQueue(storeId: string) {
  return db
    .select({
      id: einvoices.id, number: einvoices.number, serial: einvoices.serial, status: einvoices.status,
      buyerName: einvoices.buyerName, buyerTaxCode: einvoices.buyerTaxCode, vatRate: einvoices.vatRate,
      totalBeforeVat: einvoices.totalBeforeVat, vatAmount: einvoices.vatAmount, issuedAt: einvoices.issuedAt,
      attemptCount: einvoices.attemptCount, nextAttemptAt: einvoices.nextAttemptAt, lastError: einvoices.lastError,
      orderId: einvoices.orderId, orderCode: orders.code, orderTotal: orders.total,
    })
    .from(einvoices).innerJoin(orders, and(eq(einvoices.orderId, orders.id), eq(orders.storeId, storeId))).where(eq(einvoices.storeId, storeId)).orderBy(desc(einvoices.createdAt)).limit(50);
}

/** Active customers (id, name) for pickers, alphabetical, first 300. */
export async function getActiveCustomerOptions(storeId: string) {
  return db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.storeId, storeId), eq(customers.isActive, true))).orderBy(asc(customers.name)).limit(300);
}

/** Orders among `orderIds` that already have an issued e-invoice. */
export async function getIssuedEInvoiceOrderIds(storeId: string, orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return db
    .select({ orderId: einvoices.orderId })
    .from(einvoices)
    .where(and(
      eq(einvoices.storeId, storeId),
      inArray(einvoices.orderId, orderIds),
      eq(einvoices.status, "issued"),
    ));
}

/** Order lines of `orderIds` that appear on a return. */
export async function getReturnedOrderItemIds(storeId: string, orderIds: string[]) {
  if (orderIds.length === 0) return [];
  return db
    .select({ orderItemId: returnItems.orderItemId })
    .from(returnItems)
    .innerJoin(returns, eq(returnItems.returnId, returns.id))
    .where(and(
      eq(returnItems.storeId, storeId),
      inArray(returns.orderId, orderIds),
    ));
}
