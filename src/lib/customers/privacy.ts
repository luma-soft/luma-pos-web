import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  customerConsentEvents,
  customerConsents,
  customers,
  orderItems,
  orders,
  payments,
} from "@/db/schema";
import type { ActionResult } from "@/lib/actions/common";

export async function getCustomerPrivacyExport(customerId: string) {
  const [customer] = await db.select().from(customers)
    .where(eq(customers.id, customerId)).limit(1);
  if (!customer) return null;
  const [consent, consentEvents, customerOrders] = await Promise.all([
    db.select().from(customerConsents)
      .where(eq(customerConsents.customerId, customerId)).limit(1),
    db.select().from(customerConsentEvents)
      .where(eq(customerConsentEvents.customerId, customerId)),
    db.select().from(orders).where(eq(orders.customerId, customerId)),
  ]);
  const orderIds = customerOrders.map((order) => order.id);
  const [items, orderPayments] = orderIds.length === 0
    ? [[], []]
    : await Promise.all([
        db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
        db.select().from(payments).where(inArray(payments.orderId, orderIds)),
      ]);
  return {
    exportedAt: new Date(),
    customer,
    consent: consent[0] ?? null,
    consentEvents,
    orders: customerOrders,
    orderItems: items,
    payments: orderPayments,
  };
}

/**
 * PDPL erasure keeps legally relevant financial rows but removes the subject's
 * direct identifiers and consent history. Open debt must be settled first.
 */
export async function eraseCustomerPersonalData(customerId: string): Promise<ActionResult<{ mode: "anonymized" }>> {
  try {
    const [customer] = await db.select({ currentDebt: customers.currentDebt })
      .from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!customer) return { ok: false, error: "errors.notFound" };
    if (Number(customer.currentDebt) !== 0) {
      return { ok: false, error: "customers.errors.outstandingDebt" };
    }
    await db.transaction(async (tx) => {
      await tx.delete(customerConsentEvents)
        .where(eq(customerConsentEvents.customerId, customerId));
      await tx.delete(customerConsents)
        .where(eq(customerConsents.customerId, customerId));
      await tx.update(customers).set({
        code: `ERASED-${customerId.slice(0, 8)}`,
        name: "Đã ẩn danh",
        phone: null,
        zaloUserId: null,
        email: null,
        address: null,
        taxCode: null,
        debtLimit: "0",
        portalToken: null,
        note: null,
        isActive: false,
      }).where(eq(customers.id, customerId));
    });
    return { ok: true, data: { mode: "anonymized" } };
  } catch (error) {
    console.error("eraseCustomerPersonalData failed:", error);
    return { ok: false, error: "errors.serverError" };
  }
}
