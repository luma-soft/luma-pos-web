import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { db } from "@/db";
import {
  customers,
  einvoices,
  orderItems,
  orders,
  products,
  stockLevels,
} from "@/db/schema";
import {
  type ActionResult,
  getProfileId,
  toMoney,
  toQty,
} from "@/lib/actions/common";
import { Routes } from "@/lib/routes";
import { createDebtChangedEventInTx } from "@/lib/notifications/events-core";
import { publishCommittedNotification } from "@/lib/notifications/outbox";
import { recordActivity } from "@/lib/audit/activity-log";
import { orderActivitySnapshot, orderActivityType } from "@/lib/orders/activity";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";
import { revalueInventoryProducts } from "@/lib/inventory/cost-valuation";
import { getOrderStockRestorations, restoreOrderStockInTransaction } from "@/lib/inventory/order-stock-restoration";

export async function cancelQuoteForUser(
  userId: string,
  quoteId: string
): Promise<ActionResult> {
  try {
    const context = await resolveStoreContextForUser(userId);
    if (!context) return { ok: false, error: "errors.unauthorized" };
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.storeId, context.storeId), eq(orders.id, quoteId)))
        .limit(1).for("update");
      if (!order || order.status !== "quote") throw new Error("NOT_A_QUOTE");
      await tx
        .update(orders)
        .set({ status: "cancelled", updatedAt: sql`now()` })
        .where(and(eq(orders.storeId, context.storeId), eq(orders.id, quoteId)));
      await recordActivity(tx, {
        storeId: context.storeId, actorId: userId, action: "quote.cancelled", entityType: "order", entityId: quoteId,
        before: orderActivitySnapshot(order), after: orderActivitySnapshot({ ...order, status: "cancelled" }),
      });
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
  storeId: string,
  orderId: string
): Promise<ActionResult> {
  try {
    const profileId = await getProfileId(userId);

    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)))
        .limit(1).for("update");
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status === "cancelled") throw new Error("ALREADY_CANCELLED");
      if (order.status === "merged") throw new Error("ALREADY_CANCELLED");
      const [hasEInvoice] = await tx
        .select({ id: einvoices.id })
        .from(einvoices)
        .where(and(
          eq(einvoices.storeId, storeId),
          eq(einvoices.orderId, orderId),
          eq(einvoices.status, "issued"),
        ))
        .limit(1);
      if (hasEInvoice) throw new Error("HAS_EINVOICE");

      const items = await tx
        .select()
        .from(orderItems)
        .where(and(
          eq(orderItems.storeId, storeId),
          eq(orderItems.orderId, orderId),
        ));
      const isBooking = order.status === "confirmed";
      const isCompletedSale = order.status === "completed";
      const restorations = isCompletedSale ? await getOrderStockRestorations(tx, storeId, order, items) : [];
      const stockProductIds = [...new Set(restorations.map((item) => item.productId))].sort();
      const lockProductIds = [...new Set([...stockProductIds, ...(isBooking ? items.map((item) => item.productId) : [])])].sort();
      if (lockProductIds.length) {
        await tx.select({ id: products.id }).from(products)
          .where(and(eq(products.storeId, storeId), inArray(products.id, lockProductIds))).orderBy(products.id).for("update");
      }

      if (order.warehouseId && isBooking) {
        for (const i of items) {
          const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
          await tx.update(stockLevels).set({
            reserved: sql`greatest(0, ${stockLevels.reserved} - ${toQty(baseQty)})`,
            updatedAt: sql`now()`,
          }).where(sql`${stockLevels.storeId} = ${storeId} and ${stockLevels.productId} = ${i.productId} and ${stockLevels.warehouseId} = ${order.warehouseId}`);
        }
      }

      await restoreOrderStockInTransaction(tx, {
        storeId, orderId: order.id, orderCode: order.code, targets: restorations,
        refType: "order_cancel", createdBy: profileId,
      });

      let debtNotification = null;
      if (order.customerId && isCompletedSale) {
        const remaining = Number(order.total) - Number(order.amountPaid);
        const reversedDebt = Math.max(0, remaining);
        const [customer] = await tx
          .select({ currentDebt: customers.currentDebt })
          .from(customers)
          .where(and(
            eq(customers.storeId, storeId),
            eq(customers.id, order.customerId),
          ))
          .limit(1)
          .for("update");
        const debtDelta = -Math.min(
          Number(customer?.currentDebt ?? 0),
          reversedDebt,
        );
        await tx
          .update(customers)
          .set({
            currentDebt: sql`greatest(${customers.currentDebt} - ${toMoney(Math.max(0, remaining))}, 0)`,
            totalSpent: sql`greatest(${customers.totalSpent} - ${order.total}, 0)`,
          })
          .where(and(
            eq(customers.storeId, storeId),
            eq(customers.id, order.customerId),
          ));
        debtNotification = await createDebtChangedEventInTx(tx, {
          storeId: order.storeId,
          entityType: "customer",
          entityId: order.customerId,
          operationType: "order_cancel",
          operationId: order.id,
          delta: debtDelta,
          actorId: profileId,
        });
      }

      await tx
        .update(orders)
        .set({
          status: "cancelled",
          updatedAt: sql`now()`,
        })
        .where(and(eq(orders.storeId, storeId), eq(orders.id, orderId)));
      await revalueInventoryProducts(tx, storeId, stockProductIds);
      await recordActivity(tx, {
        storeId, actorId: profileId, action: `${orderActivityType(order)}.cancelled`, entityType: "order", entityId: orderId,
        before: orderActivitySnapshot(order), after: orderActivitySnapshot({ ...order, status: "cancelled" }),
      });
      return { debtNotification };
    });

    if (result.debtNotification?.created) {
      await publishCommittedNotification(result.debtNotification.eventId);
    }
    revalidatePath(Routes.POS);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.order(orderId));
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
