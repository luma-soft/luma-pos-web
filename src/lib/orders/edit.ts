import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customers, einvoices, orderItems, orders, payments, returnItems, returns, stockLevels, stockMovements,
} from "@/db/schema";
import { updateOrderSchema, type UpdateOrderInput } from "@/lib/schemas/order";
import { type ActionResult, getProfileId, generateCode, toMoney, toQty } from "@/lib/actions/common";

/**
 * Lõi sửa đơn — KHÔNG phải server action (nhận userId đã xác thực).
 * Hoàn kho dòng cũ → ghi dòng mới + trừ kho mới → tính lại nợ theo chênh lệch.
 * Dùng bởi server action updateOrder (web).
 */
export async function updateOrderForUser(userId: string, input: UpdateOrderInput): Promise<ActionResult> {
  const parsed = updateOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  try {
    const profileId = await getProfileId(userId);

    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, v.orderId)).limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "completed" && order.status !== "quote") throw new Error("NOT_EDITABLE");
      const [hasReturn] = await tx.select({ id: returns.id }).from(returns).where(eq(returns.orderId, v.orderId)).limit(1);
      if (hasReturn) throw new Error("HAS_RETURNS");
      const [hasEInvoice] = await tx.select({ id: einvoices.id }).from(einvoices).where(eq(einvoices.orderId, v.orderId)).limit(1);
      if (hasEInvoice) throw new Error("HAS_EINVOICE");

      const isQuote = order.status === "quote";
      const oldItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, v.orderId));

      // 1. Hoàn kho dòng cũ (đơn thật mới đụng kho)
      if (!isQuote && order.warehouseId) {
        for (const i of oldItems) {
          const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
          await tx.update(stockLevels).set({
            quantity: sql`${stockLevels.quantity} + ${toQty(baseQty)}`,
            updatedAt: sql`now()`,
          }).where(sql`${stockLevels.productId} = ${i.productId} and ${stockLevels.warehouseId} = ${order.warehouseId}`);
        }
      }
      await tx.delete(orderItems).where(eq(orderItems.orderId, v.orderId));

      // 2. Dòng mới
      const subtotal = v.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const total = Math.max(0, subtotal - v.discount + v.shippingFee);

      await tx.insert(orderItems).values(
        v.items.map((i) => ({
          orderId: v.orderId,
          productId: i.productId,
          productName: i.productName,
          unitName: i.unitName,
          unitMultiplier: toQty(i.unitMultiplier),
          quantity: toQty(i.quantity),
          unitPrice: toMoney(i.unitPrice),
          total: toMoney(i.quantity * i.unitPrice),
        }))
      );

      if (!isQuote && order.warehouseId) {
        for (const i of v.items) {
          const baseQty = i.quantity * i.unitMultiplier;
          await tx
            .insert(stockLevels)
            .values({ productId: i.productId, warehouseId: order.warehouseId, quantity: toQty(-baseQty) })
            .onConflictDoUpdate({
              target: [stockLevels.productId, stockLevels.warehouseId],
              set: { quantity: sql`${stockLevels.quantity} - ${toQty(baseQty)}`, updatedAt: sql`now()` },
            });
        }
        await tx.insert(stockMovements).values({
          productId: v.items[0].productId,
          warehouseId: order.warehouseId,
          type: "adjust",
          quantity: toQty(0),
          refType: "order_edit",
          refId: order.id,
          note: `Sửa đơn ${order.code}: kho đã hoàn dòng cũ và trừ theo dòng mới`,
          createdBy: profileId,
        });
      }

      // 3. Nợ & tổng mua theo chênh lệch (paid giữ nguyên)
      const paid = Number(order.amountPaid);
      const oldTotal = Number(order.total);
      const deltaTotal = total - oldTotal;
      const paymentStatus = isQuote
        ? order.paymentStatus
        : paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid";

      if (!isQuote && order.customerId && deltaTotal !== 0) {
        await tx.update(customers).set({
          currentDebt: sql`greatest(${customers.currentDebt} + ${toMoney(deltaTotal)}, 0)`,
          totalSpent: sql`greatest(${customers.totalSpent} + ${toMoney(deltaTotal)}, 0)`,
        }).where(eq(customers.id, order.customerId));
      }

      await tx.update(orders).set({
        subtotal: toMoney(subtotal),
        discount: toMoney(v.discount),
        shippingFee: toMoney(v.shippingFee),
        total: toMoney(total),
        paymentStatus,
        projectName: v.projectName || null,
        note: v.note || null,
        updatedAt: sql`now()`,
      }).where(eq(orders.id, v.orderId));
    });

    return { ok: true, data: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      NOT_EDITABLE: "orderEdit.errors.notEditable",
      HAS_RETURNS: "orderEdit.errors.hasReturns",
      HAS_EINVOICE: "orderEdit.errors.hasEInvoice",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("updateOrderForUser failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/**
 * Lõi gộp nhiều đơn cùng khách thành 1 đơn — KHÔNG phải server action.
 * items/payments chuyển sang đơn gộp, đơn gốc → status 'merged'. Không đụng kho/nợ.
 */
export async function mergeOrdersForUser(userId: string, orderIds: string[]): Promise<ActionResult<{ id: string; code: string }>> {
  if (orderIds.length < 2 || orderIds.length > 20) return { ok: false, error: "merge.errors.needTwo" };

  try {
    const profileId = await getProfileId(userId);

    const result = await db.transaction(async (tx) => {
      const sources = await tx.select().from(orders).where(inArray(orders.id, orderIds));
      if (sources.length !== orderIds.length) throw new Error("ORDER_NOT_FOUND");
      if (sources.some((o) => o.status !== "completed")) throw new Error("ONLY_COMPLETED");
      const customerIds = new Set(sources.map((o) => o.customerId ?? ""));
      if (customerIds.size !== 1 || !sources[0].customerId) throw new Error("SAME_CUSTOMER");
      const [hasReturn] = await tx.select({ id: returns.id }).from(returns).where(inArray(returns.orderId, orderIds)).limit(1);
      if (hasReturn) throw new Error("HAS_RETURNS");
      const [hasEInvoice] = await tx.select({ id: einvoices.id }).from(einvoices).where(inArray(einvoices.orderId, orderIds)).limit(1);
      if (hasEInvoice) throw new Error("HAS_EINVOICE");

      const subtotal = sources.reduce((s, o) => s + Number(o.subtotal), 0);
      const discount = sources.reduce((s, o) => s + Number(o.discount), 0);
      const shippingFee = sources.reduce((s, o) => s + Number(o.shippingFee), 0);
      const total = sources.reduce((s, o) => s + Number(o.total), 0);
      const paid = sources.reduce((s, o) => s + Number(o.amountPaid), 0);

      const [merged] = await tx.insert(orders).values({
        code: generateCode("DHG"),
        status: "completed",
        paymentStatus: paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid",
        customerId: sources[0].customerId,
        warehouseId: sources[0].warehouseId,
        projectId: sources[0].projectId,
        projectName: sources[0].projectName,
        subtotal: toMoney(subtotal),
        discount: toMoney(discount),
        shippingFee: toMoney(shippingFee),
        total: toMoney(total),
        amountPaid: toMoney(paid),
        note: `Gộp từ: ${sources.map((o) => o.code).join(", ")}`,
        createdBy: profileId,
      }).returning({ id: orders.id, code: orders.code });

      await tx.update(orderItems).set({ orderId: merged.id }).where(inArray(orderItems.orderId, orderIds));
      await tx.update(payments).set({ orderId: merged.id }).where(inArray(payments.orderId, orderIds));
      void returnItems;

      await tx.update(orders).set({
        status: "merged",
        note: sql`coalesce(${orders.note} || ' · ', '') || ${"Đã gộp vào " + merged.code}`,
        updatedAt: sql`now()`,
      }).where(inArray(orders.id, orderIds));

      return merged;
    });

    return { ok: true, data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const known: Record<string, string> = {
      ONLY_COMPLETED: "merge.errors.onlyCompleted",
      SAME_CUSTOMER: "merge.errors.sameCustomer",
      HAS_RETURNS: "merge.errors.hasReturns",
      HAS_EINVOICE: "merge.errors.hasEInvoice",
    };
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("mergeOrdersForUser failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
