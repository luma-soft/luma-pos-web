import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orders, orderItems, payments, customers, stockLevels, stockMovements, einvoices, returns,
} from "@/db/schema";
import { createOrderSchema, type CreateOrderInput } from "@/lib/schemas/order";
import {
  type ActionResult, getProfileId, generateCode, toMoney, toQty, isUniqueViolation,
} from "@/lib/actions/common";
import { recordCashTx, fundForMethod } from "@/lib/cash";
import { Routes } from "@/lib/routes";
import { normalizeOrderItems } from "@/lib/orders/normalize";
import { getCurrentShift } from "@/lib/data/shifts";

function revalidateOrderPaths(sourceOrderId?: string) {
  try {
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Products);
    if (sourceOrderId) revalidatePath(Routes.order(sourceOrderId));
  } catch (e) {
    if (e instanceof Error && e.message.includes("static generation store missing")) return;
    console.warn("createOrder revalidate failed:", e);
  }
}

/**
 * Lõi tạo đơn — KHÔNG phải server action (nhận userId đã xác thực).
 * Dùng bởi server action createOrder (web, lấy userId từ cookie session).
 * Idempotent theo clientId: tạo lại cùng clientId → trả về đơn cũ, không nhân đôi.
 *
 * Lưu ý bảo mật: userId PHẢI do server tự xác thực, KHÔNG nhận từ client.
 */
export async function createOrderForUser(
  userId: string,
  input: CreateOrderInput
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
  let trustedItems;
  try {
    trustedItems = await normalizeOrderItems(v.items, v.priceBookId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (["PRODUCT_NOT_FOUND", "UNIT_NOT_FOUND", "INVALID_ITEMS"].includes(msg)) {
      return { ok: false, error: "errors.invalidData" };
    }
    throw e;
  }
  const subtotal = trustedItems.reduce((s, i) => s + i.total, 0);
  const afterDiscount = Math.max(0, subtotal - v.discount);
  const tax = Math.round((afterDiscount * v.taxRate) / 100);
  const total = Math.max(0, afterDiscount + tax + v.shippingFee);
  const paid = isQuote || v.payment.method === "credit" ? 0 : Math.min(v.payment.amount, total);
  const remaining = total - paid;
  const paymentStatus = paid >= total ? "paid" : paid > 0 ? "deposit" : "unpaid";

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(profileId) : null;

    const result = await db.transaction(async (tx) => {
      if (v.source && isQuote) throw new Error("SOURCE_NOT_EDITABLE");

      const [sourceOrder] = v.source
        ? await tx.select().from(orders).where(eq(orders.id, v.source.orderId)).limit(1)
        : [];
      if (v.source && !sourceOrder) throw new Error("SOURCE_NOT_FOUND");

      if (v.source?.mode === "copy") {
        if (sourceOrder.status === "cancelled" || sourceOrder.status === "merged") throw new Error("SOURCE_NOT_COPYABLE");
      }

      if (v.source?.mode === "edit") {
        if (sourceOrder.status !== "completed") throw new Error("SOURCE_NOT_EDITABLE");
        if (sourceOrder.replacedByOrderId) throw new Error("SOURCE_ALREADY_REPLACED");
        const [hasReturn] = await tx.select({ id: returns.id }).from(returns).where(eq(returns.orderId, sourceOrder.id)).limit(1);
        if (hasReturn) throw new Error("SOURCE_HAS_RETURNS");
        const [hasEInvoice] = await tx.select({ id: einvoices.id }).from(einvoices).where(eq(einvoices.orderId, sourceOrder.id)).limit(1);
        if (hasEInvoice) throw new Error("SOURCE_HAS_EINVOICE");

        const sourceItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, sourceOrder.id));
        if (sourceOrder.warehouseId) {
          for (const i of sourceItems) {
            const baseQty = Number(i.quantity) * Number(i.unitMultiplier);
            await tx.update(stockLevels).set({
              quantity: sql`${stockLevels.quantity} + ${toQty(baseQty)}`,
              updatedAt: sql`now()`,
            }).where(sql`${stockLevels.productId} = ${i.productId} and ${stockLevels.warehouseId} = ${sourceOrder.warehouseId}`);
            await tx.insert(stockMovements).values({
              productId: i.productId,
              warehouseId: sourceOrder.warehouseId,
              type: "return_in",
              quantity: toQty(baseQty),
              refType: "order_edit_cancel",
              refId: sourceOrder.id,
              note: `Hủy đơn gốc ${sourceOrder.code} để sửa`,
              createdBy: profileId,
            });
          }
        }

        if (sourceOrder.customerId) {
          const sourceRemaining = Number(sourceOrder.total) - Number(sourceOrder.amountPaid);
          await tx.update(customers).set({
            currentDebt: sql`greatest(${customers.currentDebt} - ${toMoney(Math.max(0, sourceRemaining))}, 0)`,
            totalSpent: sql`greatest(${customers.totalSpent} - ${sourceOrder.total}, 0)`,
          }).where(eq(customers.id, sourceOrder.customerId));
        }

        const sourcePayments = await tx.select().from(payments).where(eq(payments.orderId, sourceOrder.id));
        for (const p of sourcePayments) {
          if (p.method === "credit") continue;
          await recordCashTx(tx, {
            type: "out",
            fund: fundForMethod(p.method),
            amount: Number(p.amount),
            category: "refund",
            refType: "order_edit_cancel",
            refId: sourceOrder.id,
            note: `Hủy đơn gốc ${sourceOrder.code} để sửa`,
            createdBy: profileId,
            shiftId: currentShift?.id ?? null,
          });
        }
      }

      const orderInsert: typeof orders.$inferInsert = {
        code: generateCode(isQuote ? "BG" : "DH"),
        clientId: v.clientId ?? null,
        status: isQuote ? "quote" : "completed",
        paymentStatus,
        shiftId: currentShift?.id ?? null,
        customerId: v.customerId ?? null,
        warehouseId: v.warehouseId,
        projectId: v.projectId ?? null,
        projectName: v.projectName || null,
        deliveryAddress: v.deliveryAddress || null,
        subtotal: toMoney(subtotal),
        discount: toMoney(v.discount),
        tax: toMoney(tax),
        shippingFee: toMoney(v.shippingFee),
        total: toMoney(total),
        amountPaid: toMoney(paid),
        sourceOrderId: v.source?.orderId ?? null,
        sourceMode: v.source?.mode ?? null,
        sourceSaleTime: v.source?.mode === "edit" ? sourceOrder.createdAt : null,
        note: v.note || null,
        createdBy: profileId,
      };
      if (v.source?.mode === "edit") orderInsert.createdAt = sourceOrder.createdAt;

      const [order] = await tx.insert(orders).values(orderInsert).returning({ id: orders.id, code: orders.code });

      if (v.source?.mode === "edit") {
        await tx.update(orders).set({
          status: "cancelled",
          replacedByOrderId: order.id,
          note: `${sourceOrder.note ? `${sourceOrder.note} · ` : ""}Đã hủy để sửa, thay bằng ${order.code}`,
          updatedAt: sql`now()`,
        }).where(eq(orders.id, sourceOrder.id));
      }

      await tx.insert(orderItems).values(
        trustedItems.map((i) => ({
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
          shiftId: currentShift?.id ?? null,
          amount: toMoney(paid),
          method: v.payment.method,
          reference: v.payment.reference?.trim() || null,
          createdBy: profileId,
        });
        await recordCashTx(tx, {
          type: "in", fund: fundForMethod(v.payment.method), amount: paid,
          category: "sale", refType: "order", refId: order.id,
          note: order.code, createdBy: profileId, shiftId: currentShift?.id ?? null,
        });
      }

      // Báo giá: không trừ kho, không công nợ
      if (isQuote) return order;

      // Trừ kho theo base unit + ghi movement
      for (const i of trustedItems) {
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

    revalidateOrderPaths(v.source?.orderId);
    return { ok: true, data: result };
  } catch (e) {
    // Trùng clientId (đua khi đồng bộ song song) → đơn đã tồn tại, trả về đơn cũ.
    if (v.clientId && isUniqueViolation(e)) {
      const [existing] = await db.select({ id: orders.id, code: orders.code }).from(orders).where(eq(orders.clientId, v.clientId)).limit(1);
      if (existing) return { ok: true, data: existing };
    }
    const known: Record<string, string> = {
      SOURCE_NOT_FOUND: "orders.errors.sourceNotFound",
      SOURCE_NOT_COPYABLE: "orders.errors.sourceNotCopyable",
      SOURCE_NOT_EDITABLE: "orderEdit.errors.notEditable",
      SOURCE_ALREADY_REPLACED: "orderEdit.errors.notEditable",
      SOURCE_HAS_RETURNS: "orderEdit.errors.hasReturns",
      SOURCE_HAS_EINVOICE: "orderEdit.errors.hasEInvoice",
    };
    const msg = e instanceof Error ? e.message : "";
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("createOrder failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
