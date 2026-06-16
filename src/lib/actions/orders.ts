"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orders, orderItems, customers, einvoices, stockLevels, stockMovements,
} from "@/db/schema";
import {
  type CreateOrderOutput, type AddPaymentInput,
} from "@/lib/schemas/order";
import {
  type ActionResult, requireUser, requireManager, getProfileId, toMoney, toQty,
} from "./common";
import { Routes } from "@/lib/routes";
import { createOrderForUser } from "@/lib/orders/create";
import { addPaymentForUser } from "@/lib/orders/payment";
import { convertQuoteToOrderForUser } from "@/lib/orders/convert";

export async function createOrder(
  input: CreateOrderOutput
): Promise<ActionResult<{ id: string; code: string }>> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  // Lõi tách riêng. Xem src/lib/orders/create.ts.
  return createOrderForUser(userId, input);
}

export async function addPayment(input: AddPaymentInput): Promise<ActionResult> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  // Lõi tách riêng. Xem src/lib/orders/payment.ts.
  return addPaymentForUser(userId, input);
}

/** Chốt báo giá thành đơn: trừ kho + ghi nợ. Thu tiền sau qua addPayment. */
export async function convertQuoteToOrder(quoteId: string): Promise<ActionResult<{ code: string }>> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  // Lõi tách riêng. Xem src/lib/orders/convert.ts.
  const result = await convertQuoteToOrderForUser(userId, quoteId);
  if (result.ok) {
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Quotes);
    revalidatePath(Routes.order(quoteId));
  }
  return result;
}

/** Hủy báo giá (không ảnh hưởng kho/nợ). */
export async function cancelQuote(quoteId: string): Promise<ActionResult> {
  try {
    await requireUser();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, quoteId)).limit(1);
      if (!order || order.status !== "quote") throw new Error("NOT_A_QUOTE");
      await tx.update(orders).set({ status: "cancelled", updatedAt: sql`now()` }).where(eq(orders.id, quoteId));
    });
    revalidatePath(Routes.Quotes);
    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_A_QUOTE") return { ok: false, error: "quotes.errors.notAQuote" };
    console.error("cancelQuote failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function cancelOrder(orderId: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const userId = gate.userId;

  try {
    const profileId = await getProfileId(userId);

    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status === "cancelled") throw new Error("ALREADY_CANCELLED");
      if (order.status === "merged") throw new Error("ALREADY_CANCELLED"); // đơn gộp gốc không hủy được
      const [hasEInvoice] = await tx.select({ id: einvoices.id }).from(einvoices).where(eq(einvoices.orderId, orderId)).limit(1);
      if (hasEInvoice) throw new Error("HAS_EINVOICE");

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));

      // Hoàn kho
      if (order.warehouseId) {
        for (const i of items) {
          const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
          await tx.update(stockLevels).set({
            quantity: sql`${stockLevels.quantity} + ${toQty(baseQty)}`,
            updatedAt: sql`now()`,
          }).where(sql`${stockLevels.productId} = ${i.productId} and ${stockLevels.warehouseId} = ${order.warehouseId}`);
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

      // Hoàn công nợ phần chưa trả + trừ totalSpent
      if (order.customerId) {
        const remaining = Number(order.total) - Number(order.amountPaid);
        await tx.update(customers).set({
          currentDebt: sql`greatest(${customers.currentDebt} - ${toMoney(Math.max(0, remaining))}, 0)`,
          totalSpent: sql`greatest(${customers.totalSpent} - ${order.total}, 0)`,
        }).where(eq(customers.id, order.customerId));
      }

      await tx.update(orders).set({
        status: "cancelled",
        updatedAt: sql`now()`,
      }).where(eq(orders.id, orderId));
    });

    revalidatePath(Routes.Orders);
    revalidatePath(Routes.order(orderId));
    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ALREADY_CANCELLED") return { ok: false, error: "orders.errors.alreadyCancelled" };
    if (msg === "HAS_EINVOICE") return { ok: false, error: "orderEdit.errors.hasEInvoice" };
    console.error("cancelOrder failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
