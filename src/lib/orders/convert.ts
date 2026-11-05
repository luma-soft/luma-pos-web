import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { db } from "@/db";
import { orders, orderItems, payments, customers, products, productUnits, stockLevels, stockMovements } from "@/db/schema";
import { type ActionResult, getProfileId, generateCode, toQty } from "@/lib/actions/common";
import { Routes } from "@/lib/routes";
import { createNotificationEventInTx } from "@/lib/notifications/events-core";
import { publishCommittedNotification } from "@/lib/notifications/outbox";
import { recordActivity } from "@/lib/audit/activity-log";
import { orderActivitySnapshot, orderActivityType } from "@/lib/orders/activity";

/**
 * Lõi chốt báo giá/đặt hàng → đơn bán — KHÔNG phải server action (nhận userId đã xác thực).
 * Trừ kho + ghi công nợ phần còn lại; thu tiền sau qua addPayment.
 */
export async function convertQuoteToOrderForUser(
  userId: string,
  storeId: string,
  quoteId: string
): Promise<ActionResult<{ code: string }>> {
  return convertSourceOrderToInvoiceForUser(userId, storeId, quoteId, false);
}

/** Chốt đơn nháp thành hóa đơn bán hàng, ghi kho và công nợ một lần. */
export async function finalizeDraftOrderForUser(
  userId: string,
  storeId: string,
  orderId: string
): Promise<ActionResult<{ code: string }>> {
  return convertSourceOrderToInvoiceForUser(userId, storeId, orderId, true);
}

async function convertSourceOrderToInvoiceForUser(
  userId: string,
  storeId: string,
  sourceOrderId: string,
  allowDraft: boolean,
): Promise<ActionResult<{ code: string }>> {
  try {
    const profileId = await getProfileId(userId);

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(and(eq(orders.id, sourceOrderId), eq(orders.storeId, storeId))).limit(1).for("update");
      if (!order) throw new Error("ORDER_NOT_FOUND");
      const isDraft = order.status === "draft";
      if (allowDraft && order.status === "completed" && order.documentType === "sale") {
        return { code: order.code, notification: null };
      }
      const [draftPayment] = allowDraft && isDraft
        ? await tx.select({ id: payments.id }).from(payments)
          .where(and(eq(payments.storeId, storeId), eq(payments.orderId, sourceOrderId))).limit(1)
        : [];
      if (allowDraft
        ? !isDraft || order.documentType !== "sale" || order.posDraftPayload != null || Number(order.amountPaid) !== 0 || Boolean(draftPayment)
        : order.status !== "quote" && order.status !== "confirmed") {
        throw new Error("NOT_CONVERTIBLE");
      }
      if (!order.warehouseId) throw new Error("NO_WAREHOUSE");

      const items = await tx.select().from(orderItems).where(and(eq(orderItems.orderId, sourceOrderId), eq(orderItems.storeId, storeId)));
      if (!items.length) throw new Error("NOT_CONVERTIBLE");
      const productIds = [...new Set(items.map((item) => item.productId))];
      const productRows = productIds.length
        ? await tx.select({ id: products.id, baseUnit: products.baseUnit, baseUnitDirectSale: products.baseUnitDirectSale })
          .from(products).where(and(eq(products.storeId, storeId), inArray(products.id, productIds))).for("share")
        : [];
      const unitRows = productIds.length
        ? await tx.select({ productId: productUnits.productId, unitName: productUnits.unitName, directSale: productUnits.directSale })
          .from(productUnits).where(and(eq(productUnits.storeId, storeId), inArray(productUnits.productId, productIds))).for("share")
        : [];
      const productById = new Map(productRows.map((product) => [product.id, product]));
      for (const item of items) {
        const product = productById.get(item.productId);
        const available = item.unitName === product?.baseUnit
          ? product.baseUnitDirectSale
          : unitRows.find((unit) => unit.productId === item.productId && unit.unitName === item.unitName)?.directSale;
        if (available === false) throw new Error("UNIT_NOT_SELLABLE");
      }
      const sourceWasBooking = order.status === "confirmed";

      const newCode = isDraft ? order.code : generateCode("DH");
      const sourceLabel = isDraft ? "đơn nháp" : order.status === "quote" ? "báo giá" : "đặt hàng";
      await tx.update(orders).set({
        code: newCode,
        documentType: "sale",
        status: "completed",
        ...(!isDraft ? {
          note: order.note ? `${order.note} · từ ${sourceLabel} ${order.code}` : `Từ ${sourceLabel} ${order.code}`,
        } : {}),
        updatedAt: sql`now()`,
      }).where(and(eq(orders.id, sourceOrderId), eq(orders.storeId, storeId)));

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
          note: isDraft ? `${newCode} (chốt từ đơn nháp)` : `${newCode} (chốt từ ${sourceLabel} ${order.code})`,
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
          source: isDraft ? "draft_finalization" : order.status === "quote" ? "quote_conversion" : "booking_conversion",
        },
      });

      await recordActivity(tx, {
        storeId, actorId: profileId, action: `${orderActivityType(order)}.converted`, entityType: "order", entityId: order.id,
        before: orderActivitySnapshot(order),
        after: orderActivitySnapshot({ ...order, code: newCode, documentType: "sale", status: "completed" }),
        metadata: { sourceOrderCode: order.code, source: isDraft ? "draft_finalization" : undefined },
      });
      return { code: newCode, notification };
    });

    if (result.notification?.created) {
      await publishCommittedNotification(result.notification.eventId);
    }
    revalidatePath(Routes.POS);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.order(sourceOrderId));
    return { ok: true, data: { code: result.code } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_CONVERTIBLE") return { ok: false, error: "orders.errors.notConvertible" };
    if (msg === "ORDER_NOT_FOUND") return { ok: false, error: "orders.errors.notFound" };
    if (msg === "UNIT_NOT_SELLABLE") return { ok: false, error: "pos.errors.unitUnavailable" };
    console.error("convertQuoteToOrderForUser failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
