import { and, eq, sql } from "drizzle-orm";
import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
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
  storeId: string,
  quoteId: string
): Promise<ActionResult<{ code: string }>> {
  try {
      const profileId = await getProfileId(userId);

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(and(eq(orders.id, quoteId), eq(orders.storeId, storeId))).limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "quote" && order.status !== "confirmed") throw new Error("NOT_CONVERTIBLE");
      if (!order.warehouseId) throw new Error("NO_WAREHOUSE");

      const items = await tx.select().from(orderItems).where(and(eq(orderItems.orderId, quoteId), eq(orderItems.storeId, storeId)));
      const sourceWasBooking = order.status === "confirmed";

      const newCode = generateCode("DH");
      const sourceLabel = order.status === "quote" ? "báo giá" : "đặt hàng";
      await tx.update(orders).set({
        code: newCode,
        documentType: "sale",
        status: "completed",
        note: order.note ? `${order.note} · từ ${sourceLabel} ${order.code}` : `Từ ${sourceLabel} ${order.code}`,
        updatedAt: sql`now()`,
      }).where(and(eq(orders.id, quoteId), eq(orders.storeId, storeId)));

      for (const i of items) {
        const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
        await tx
          .insert(stockLevels)
          .values({ storeId, productId: i.productId, warehouseId: order.warehouseId, quantity: toQty(-baseQty) })
          .onConflictDoUpdate({
            target: [stockLevels.storeId, stockLevels.productId, stockLevels.warehouseId],
            set: {
              quantity: sql`${stockLevels.quantity} - ${toQty(baseQty)}`,
              reserved: sourceWasBooking
                ? sql`greatest(0, ${stockLevels.reserved} - ${toQty(baseQty)})`
                : stockLevels.reserved,
              updatedAt: sql`now()`,
            },
          });
        await tx.insert(stockMovements).values({
          storeId,
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
        }).where(and(eq(customers.id, order.customerId), eq(customers.storeId, storeId)));
      }

      const remaining = Math.max(0, Number(order.total) - Number(order.amountPaid));
      const notification = await createNotificationEventInTx(tx, {
        storeId: order.storeId,
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
