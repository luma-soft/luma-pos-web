import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  einvoices,
  orderItems,
  orders,
  stockLevels,
  stockMovements,
} from "@/db/schema";
import {
  type ActionResult,
  getProfileId,
  toMoney,
  toQty,
} from "@/lib/actions/common";

export async function cancelQuoteForUser(
  _userId: string,
  quoteId: string
): Promise<ActionResult> {
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, quoteId))
        .limit(1);
      if (!order || order.status !== "quote") throw new Error("NOT_A_QUOTE");
      await tx
        .update(orders)
        .set({ status: "cancelled", updatedAt: sql`now()` })
        .where(eq(orders.id, quoteId));
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_A_QUOTE") {
      return { ok: false, error: "quotes.errors.notAQuote" };
    }
    console.error("cancelQuoteForUser failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function cancelOrderForUser(
  userId: string,
  orderId: string
): Promise<ActionResult> {
  try {
    const profileId = await getProfileId(userId);

    await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status === "cancelled") throw new Error("ALREADY_CANCELLED");
      if (order.status === "merged") throw new Error("ALREADY_CANCELLED");
      const [hasEInvoice] = await tx
        .select({ id: einvoices.id })
        .from(einvoices)
        .where(and(eq(einvoices.orderId, orderId), eq(einvoices.status, "issued")))
        .limit(1);
      if (hasEInvoice) throw new Error("HAS_EINVOICE");

      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      if (order.warehouseId) {
        for (const i of items) {
          const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
          await tx
            .update(stockLevels)
            .set({
              quantity: sql`${stockLevels.quantity} + ${toQty(baseQty)}`,
              updatedAt: sql`now()`,
            })
            .where(
              sql`${stockLevels.productId} = ${i.productId} and ${stockLevels.warehouseId} = ${order.warehouseId}`
            );
          await tx.insert(stockMovements).values({
            productId: i.productId,
            warehouseId: order.warehouseId,
            type: "return_in",
            quantity: toQty(baseQty),
            refType: "order_cancel",
            refId: order.id,
            note: `Hủy đơn ${order.code}`,
            createdBy: profileId,
          });
        }
      }

      if (order.customerId) {
        const remaining = Number(order.total) - Number(order.amountPaid);
        await tx
          .update(customers)
          .set({
            currentDebt: sql`greatest(${customers.currentDebt} - ${toMoney(Math.max(0, remaining))}, 0)`,
            totalSpent: sql`greatest(${customers.totalSpent} - ${order.total}, 0)`,
          })
          .where(eq(customers.id, order.customerId));
      }

      await tx
        .update(orders)
        .set({
          status: "cancelled",
          updatedAt: sql`now()`,
        })
        .where(eq(orders.id, orderId));
    });

    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ALREADY_CANCELLED") {
      return { ok: false, error: "orders.errors.alreadyCancelled" };
    }
    if (msg === "HAS_EINVOICE") {
      return { ok: false, error: "orderEdit.errors.hasEInvoice" };
    }
    if (msg === "ORDER_NOT_FOUND") {
      return { ok: false, error: "orders.errors.notFound" };
    }
    console.error("cancelOrderForUser failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
