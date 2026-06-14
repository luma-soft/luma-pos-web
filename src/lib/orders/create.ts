import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orders, orderItems, payments, customers, stockLevels, stockMovements,
} from "@/db/schema";
import { createOrderSchema, type CreateOrderOutput } from "@/lib/schemas/order";
import {
  type ActionResult, getProfileId, generateCode, toMoney, toQty, isUniqueViolation,
} from "@/lib/actions/common";
import { recordCashTx, fundForMethod } from "@/lib/cash";
import { Routes } from "@/lib/routes";

/**
 * Lõi tạo đơn — KHÔNG phải server action (nhận userId đã xác thực).
 * Dùng bởi server action createOrder (web, lấy userId từ cookie session).
 * Idempotent theo clientId: tạo lại cùng clientId → trả về đơn cũ, không nhân đôi.
 *
 * Lưu ý bảo mật: userId PHẢI do server tự xác thực, KHÔNG nhận từ client.
 */
export async function createOrderForUser(
  userId: string,
  input: CreateOrderOutput
): Promise<ActionResult<{ id: string; code: string }>> {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;

  // Khử trùng: nếu đơn với clientId này đã tạo (đồng bộ lại) → trả về đơn cũ, không tạo trùng.
  if (v.clientId) {
    const [existing] = await db.select({ id: orders.id, code: orders.code }).from(orders).where(eq(orders.clientId, v.clientId)).limit(1);
    if (existing) return { ok: true, data: existing };
  }

  // Server tự tính tiền — không tin client
  const isQuote = v.mode === "quote";
  const subtotal = v.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const total = Math.max(0, subtotal - v.discount + v.shippingFee);
  const paid = isQuote || v.payment.method === "credit" ? 0 : Math.min(v.payment.amount, total);
  const remaining = total - paid;
  const paymentStatus = paid >= total ? "paid" : paid > 0 ? "deposit" : "unpaid";

  try {
    const profileId = await getProfileId(userId);

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.insert(orders).values({
        code: generateCode(isQuote ? "BG" : "DH"),
        clientId: v.clientId ?? null,
        status: isQuote ? "quote" : "completed",
        paymentStatus,
        customerId: v.customerId ?? null,
        warehouseId: v.warehouseId,
        projectId: v.projectId ?? null,
        projectName: v.projectName || null,
        deliveryAddress: v.deliveryAddress || null,
        subtotal: toMoney(subtotal),
        discount: toMoney(v.discount),
        shippingFee: toMoney(v.shippingFee),
        total: toMoney(total),
        amountPaid: toMoney(paid),
        note: v.note || null,
        createdBy: profileId,
      }).returning({ id: orders.id, code: orders.code });

      await tx.insert(orderItems).values(
        v.items.map((i) => ({
          orderId: order.id,
          productId: i.productId,
          productName: i.productName,
          unitName: i.unitName,
          unitMultiplier: toQty(i.unitMultiplier),
          quantity: toQty(i.quantity),
          unitPrice: toMoney(i.unitPrice),
          total: toMoney(i.quantity * i.unitPrice),
        }))
      );

      if (paid > 0) {
        await tx.insert(payments).values({
          orderId: order.id,
          amount: toMoney(paid),
          method: v.payment.method,
          createdBy: profileId,
        });
        await recordCashTx(tx, {
          type: "in", fund: fundForMethod(v.payment.method), amount: paid,
          category: "sale", refType: "order", refId: order.id,
          note: order.code, createdBy: profileId,
        });
      }

      // Báo giá: không trừ kho, không công nợ
      if (isQuote) return order;

      // Trừ kho theo base unit + ghi movement
      for (const i of v.items) {
        const baseQty = i.quantity * i.unitMultiplier;
        await tx
          .insert(stockLevels)
          .values({
            productId: i.productId,
            warehouseId: v.warehouseId,
            quantity: toQty(-baseQty),
          })
          .onConflictDoUpdate({
            target: [stockLevels.productId, stockLevels.warehouseId],
            set: {
              quantity: sql`${stockLevels.quantity} - ${toQty(baseQty)}`,
              updatedAt: sql`now()`,
            },
          });
        await tx.insert(stockMovements).values({
          productId: i.productId,
          warehouseId: v.warehouseId,
          type: "sale",
          quantity: toQty(-baseQty),
          refType: "order",
          refId: order.id,
          note: `${order.code} · ${i.quantity} ${i.unitName}`,
          createdBy: profileId,
        });
      }

      // Công nợ + tổng mua của khách
      if (v.customerId) {
        await tx.update(customers).set({
          currentDebt: sql`${customers.currentDebt} + ${toMoney(remaining)}`,
          totalSpent: sql`${customers.totalSpent} + ${toMoney(total)}`,
        }).where(eq(customers.id, v.customerId));
      }

      return order;
    });

    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Products);
    return { ok: true, data: result };
  } catch (e) {
    // Trùng clientId (đua khi đồng bộ song song) → đơn đã tồn tại, trả về đơn cũ.
    if (v.clientId && isUniqueViolation(e)) {
      const [existing] = await db.select({ id: orders.id, code: orders.code }).from(orders).where(eq(orders.clientId, v.clientId)).limit(1);
      if (existing) return { ok: true, data: existing };
    }
    console.error("createOrder failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
