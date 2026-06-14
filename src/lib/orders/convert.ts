import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, orderItems, customers, stockLevels, stockMovements } from "@/db/schema";
import { type ActionResult, getProfileId, generateCode, toQty } from "@/lib/actions/common";

/**
 * Lõi chốt báo giá → đơn — KHÔNG phải server action (nhận userId đã xác thực).
 * Dùng bởi server action convertQuoteToOrder (web).
 * Trừ kho + ghi nợ; thu tiền sau qua addPayment.
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
      if (order.status !== "quote") throw new Error("NOT_A_QUOTE");
      if (!order.warehouseId) throw new Error("NO_WAREHOUSE");

      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, quoteId));

      const newCode = generateCode("DH");
      await tx.update(orders).set({
        code: newCode,
        status: "completed",
        note: order.note ? `${order.note} · từ báo giá ${order.code}` : `Từ báo giá ${order.code}`,
        updatedAt: sql`now()`,
      }).where(eq(orders.id, quoteId));

      for (const i of items) {
        const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
        await tx
          .insert(stockLevels)
          .values({ productId: i.productId, warehouseId: order.warehouseId, quantity: toQty(-baseQty) })
          .onConflictDoUpdate({
            target: [stockLevels.productId, stockLevels.warehouseId],
            set: { quantity: sql`${stockLevels.quantity} - ${toQty(baseQty)}`, updatedAt: sql`now()` },
          });
        await tx.insert(stockMovements).values({
          productId: i.productId,
          warehouseId: order.warehouseId,
          type: "sale",
          quantity: toQty(-baseQty),
          refType: "order",
          refId: order.id,
          note: `${newCode} (chốt từ ${order.code})`,
          createdBy: profileId,
        });
      }

      if (order.customerId) {
        await tx.update(customers).set({
          currentDebt: sql`${customers.currentDebt} + ${order.total}`,
          totalSpent: sql`${customers.totalSpent} + ${order.total}`,
        }).where(eq(customers.id, order.customerId));
      }

      return { code: newCode };
    });

    return { ok: true, data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_A_QUOTE") return { ok: false, error: "quotes.errors.notAQuote" };
    if (msg === "ORDER_NOT_FOUND") return { ok: false, error: "orders.errors.notFound" };
    console.error("convertQuoteToOrderForUser failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
