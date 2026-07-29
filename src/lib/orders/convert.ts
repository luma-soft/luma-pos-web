import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { orders, orderItems, customers, stockLevels, stockMovements } from "@/db/schema";
import { type ActionResult, getProfileId, generateCode, toQty } from "@/lib/actions/common";
import { Routes } from "@/lib/routes";
import { createNotificationEventInTx } from "@/lib/notifications/events-core";
import { publishCommittedNotification } from "@/lib/notifications/outbox";

/**
 * Lõi chốt báo giá/đặt hàng → đơn bán — KHÔNG phải server action (nhận userId đã xác thực).
 * Trừ kho + ghi công nợ phần còn lại; thu tiền sau qua addPayment.
 */
export async function convertQuoteToOrderForUser(
  userId: string,
  quoteId: string
): Promise<ActionResult<{ code: string }>> {
  try {
      const profileId = await getProfileId(userId);

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, quoteId)).limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "quote" && order.status !== "confirmed") throw new Error("NOT_CONVERTIBLE");
      if (!order.warehouseId) throw new Error("NO_WAREHOUSE");

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, quoteId));
      const sourceWasBooking = order.status === "confirmed";

      const newCode = generateCode("DH");
      const sourceLabel = order.status === "quote" ? "báo giá" : "đặt hàng";
      await tx.update(orders).set({
        code: newCode,
        status: "completed",
        note: order.note ? `${order.note} · từ ${sourceLabel} ${order.code}` : `Từ ${sourceLabel} ${order.code}`,
        updatedAt: sql`now()`,
      }).where(eq(orders.id, quoteId));

      for (const i of items) {
        const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
        await tx
          .insert(stockLevels)
          .values({ productId: i.productId, warehouseId: order.warehouseId, quantity: toQty(-baseQty) })
          .onConflictDoUpdate({
            target: [stockLevels.productId, stockLevels.warehouseId],
            set: {
              quantity: sql`${stockLevels.quantity} - ${toQty(baseQty)}`,
              reserved: sourceWasBooking
                ? sql`greatest(0, ${stockLevels.reserved} - ${toQty(baseQty)})`
                : stockLevels.reserved,
              updatedAt: sql`now()`,
            },
          });
        await tx.insert(stockMovements).values({
          productId: i.productId,
          warehouseId: order.warehouseId,
              type: "sale",
          quantity: toQty(-baseQty),
          refType: "order",
          refId: order.id,
          note: `${newCode} (chốt từ ${sourceLabel} ${order.code})`,
          createdBy: profileId,
        });
      }

      if (order.customerId) {
        const remaining = Math.max(0, Number(order.total) - Number(order.amountPaid));
        await tx.update(customers).set({
          currentDebt: sql`${customers.currentDebt} + ${remaining}`,
          totalSpent: sql`${customers.totalSpent} + ${order.total}`,
        }).where(eq(customers.id, order.customerId));
      }

      const remaining = Math.max(0, Number(order.total) - Number(order.amountPaid));
      const notification = await createNotificationEventInTx(tx, {
        eventKey: `invoice-created:${order.id}`,
        category: "invoiceCreated",
        entityType: "order",
        entityId: order.id,
        actorId: profileId,
        target: "invoices",
        priority: "normal",
        quietHoursPolicy: "defer",
        excludeActor: true,
        metadata: {
          debtDelta: remaining.toFixed(2),
          source: order.status === "quote" ? "quote_conversion" : "booking_conversion",
        },
      });

      return { code: newCode, notification };
    });

    if (result.notification?.created) {
      await publishCommittedNotification(result.notification.eventId);
    }
    revalidatePath(Routes.POS);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.order(quoteId));
    return { ok: true, data: { code: result.code } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_CONVERTIBLE") return { ok: false, error: "orders.errors.notConvertible" };
    if (msg === "ORDER_NOT_FOUND") return { ok: false, error: "orders.errors.notFound" };
    console.error("convertQuoteToOrderForUser failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
