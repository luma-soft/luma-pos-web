import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orders, orderItems, payments, customers, products, priceBooks, stockLevels, stockMovements, einvoices, returns,
} from "@/db/schema";
import { createOrderSchema, type CreateOrderInput } from "@/lib/schemas/order";
import {
  type ActionResult, getProfileId, getRole, generateCode, toMoney, toQty, isUniqueViolation,
} from "@/lib/actions/common";
import { recordCashTx, fundForMethod } from "@/lib/cash";
import { Routes } from "@/lib/routes";
import { normalizeOrderItems } from "@/lib/orders/normalize";
import { getCurrentShift } from "@/lib/data/shifts";
import { calculateProductTax } from "@/lib/orders/product-tax";
import { consumeTrackedStockLots, restoreTrackedStockLots } from "@/lib/inventory/stock-lot-service";
import { createNotificationEventInTx } from "@/lib/notifications/events-core";
import { publishCommittedNotification } from "@/lib/notifications/outbox";

function revalidateOrderPaths(sourceOrderId?: string) {
  try {
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.Products);
    revalidatePath(Routes.POS);
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

  const requestedPriceBookIds = [...new Set(v.items
    .map((item) => item.priceBookId === undefined ? v.priceBookId : item.priceBookId)
    .filter((id): id is string => Boolean(id)))];
  if (requestedPriceBookIds.length > 0) {
    const selectedPriceBooks = await db
      .select({ id: priceBooks.id, managerOnly: priceBooks.managerOnly })
      .from(priceBooks)
      .where(inArray(priceBooks.id, requestedPriceBookIds));
    if (selectedPriceBooks.length !== requestedPriceBookIds.length) return { ok: false, error: "errors.invalidData" };
    if (selectedPriceBooks.some((priceBook) => priceBook.managerOnly)) {
      const role = await getRole(userId);
      if (role !== "owner" && role !== "manager") return { ok: false, error: "errors.forbidden" };
    }
  }

  const paymentPending = v.paymentPending === true;
  if (
    paymentPending &&
    (v.mode !== "sale" ||
      v.payment.method !== "credit" ||
      v.payment.amount !== 0 ||
      !v.clientId)
  ) {
    return { ok: false, error: "errors.invalidData" };
  }

  // Khử trùng: nếu đơn với clientId này đã tạo (đồng bộ lại) → trả về đơn cũ, không tạo trùng.
  if (v.clientId) {
    const [existing] = await db.select({ id: orders.id, code: orders.code }).from(orders).where(eq(orders.clientId, v.clientId)).limit(1);
    if (existing) return { ok: true, data: existing };
  }

  // Server tự tính tiền — không tin client
  const isQuote = v.mode === "quote";
  const isBooking = v.mode === "booking";
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
  const productTaxRows = await db
    .select({ id: products.id, vatRate: products.vatRate })
    .from(products)
    .where(inArray(products.id, [...new Set(trustedItems.map((item) => item.productId))]));
  const vatRateByProduct = new Map(
    productTaxRows.map((product) => [
      product.id,
      product.vatRate == null ? null : Number(product.vatRate),
    ]),
  );
  const tax = calculateProductTax({
    lines: trustedItems.map((item) => ({
      total: item.total,
      vatRate: vatRateByProduct.get(item.productId) ?? null,
    })),
    discount: v.discount,
    fallbackVatRate: v.taxRate,
  });
  const total = Math.max(0, afterDiscount + tax + v.shippingFee);
  const paid = isQuote || isBooking || v.payment.method === "credit" ? 0 : Math.min(v.payment.amount, total);
  const remaining = total - paid;
  const paymentStatus = paymentPending
    ? "unpaid"
    : paid >= total
      ? "paid"
      : paid > 0
        ? "deposit"
        : "unpaid";

  try {
    const profileId = await getProfileId(userId);
    const currentShift = profileId ? await getCurrentShift(profileId) : null;

    const result = await db.transaction(async (tx) => {
      const [sourceOrder] = v.source
        ? await tx.select().from(orders).where(eq(orders.id, v.source.orderId)).limit(1)
        : [];
      if (v.source && !sourceOrder) throw new Error("SOURCE_NOT_FOUND");
      const sourceIsSale = sourceOrder?.status === "completed";
      const sourceIsQuote = sourceOrder?.status === "quote";
      const sourceIsBooking = sourceOrder?.status === "confirmed";

      if (v.source?.mode === "copy") {
        if (sourceOrder.status === "cancelled" || sourceOrder.status === "merged") throw new Error("SOURCE_NOT_COPYABLE");
      }

      if (v.source?.mode === "edit") {
        const sourceMatchesMode = (isQuote && sourceIsQuote) || (isBooking && sourceIsBooking) || (!isQuote && !isBooking && sourceIsSale);
        if (!sourceMatchesMode) throw new Error("SOURCE_NOT_EDITABLE");
        if (sourceOrder.replacedByOrderId) throw new Error("SOURCE_ALREADY_REPLACED");
        const [hasReturn] = await tx.select({ id: returns.id }).from(returns)
          .where(and(eq(returns.orderId, sourceOrder.id), eq(returns.status, "completed"))).limit(1);
        if (hasReturn) throw new Error("SOURCE_HAS_RETURNS");
        const [hasEInvoice] = await tx.select({ id: einvoices.id }).from(einvoices).where(eq(einvoices.orderId, sourceOrder.id)).limit(1);
        if (hasEInvoice) throw new Error("SOURCE_HAS_EINVOICE");

        if (sourceIsSale && sourceOrder.warehouseId) {
          const sourceStockMovements = await tx
            .select({
              productId: stockMovements.productId,
              quantity: stockMovements.quantity,
            })
            .from(stockMovements)
            .where(and(
              eq(stockMovements.refType, "order"),
              eq(stockMovements.refId, sourceOrder.id),
              eq(stockMovements.type, "sale"),
            ));
          for (const movement of sourceStockMovements) {
            const baseQty = Math.abs(Number(movement.quantity));
            await restoreTrackedStockLots(tx, {
              productId: movement.productId,
              quantity: baseQty,
              sourceRefType: "order",
              sourceRefId: sourceOrder.id,
              refType: "order_edit_cancel",
              refId: sourceOrder.id,
              createdBy: profileId,
            });
            await tx.update(stockLevels).set({
              quantity: sql`${stockLevels.quantity} + ${toQty(baseQty)}`,
              updatedAt: sql`now()`,
            }).where(sql`${stockLevels.productId} = ${movement.productId} and ${stockLevels.warehouseId} = ${sourceOrder.warehouseId}`);
            await tx.insert(stockMovements).values({
              productId: movement.productId,
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

        // Phiếu đặt cũ đã giữ tồn nhưng chưa xuất kho: giải phóng trước khi tạo phiếu thay thế.
        if (sourceIsBooking && sourceOrder.warehouseId) {
          const sourceItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, sourceOrder.id));
          for (const item of sourceItems) {
            const baseQty = Number(item.quantity) * Number(item.unitMultiplier);
            await tx.update(stockLevels).set({
              reserved: sql`greatest(0, ${stockLevels.reserved} - ${toQty(baseQty)})`,
              updatedAt: sql`now()`,
            }).where(sql`${stockLevels.productId} = ${item.productId} and ${stockLevels.warehouseId} = ${sourceOrder.warehouseId}`);
          }
        }

        if (sourceIsSale && sourceOrder.customerId) {
          const sourceRemaining = Number(sourceOrder.total) - Number(sourceOrder.amountPaid);
          await tx.update(customers).set({
            currentDebt: sql`greatest(${customers.currentDebt} - ${toMoney(Math.max(0, sourceRemaining))}, 0)`,
            totalSpent: sql`greatest(${customers.totalSpent} - ${sourceOrder.total}, 0)`,
          }).where(eq(customers.id, sourceOrder.customerId));
        }

        if (sourceIsSale) {
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
      }

      const orderInsert: typeof orders.$inferInsert = {
        code: generateCode(isQuote ? "BG" : "DH"),
        clientId: v.clientId ?? null,
        documentType: isQuote ? "quote" : isBooking ? "booking" : "sale",
        status: isQuote
          ? "quote"
          : isBooking
            ? "confirmed"
            : paymentPending
              ? "draft"
              : "completed",
        paymentStatus,
        shiftId: currentShift?.id ?? null,
        customerId: v.customerId ?? null,
        warehouseId: v.warehouseId,
        projectId: v.projectId ?? null,
        projectName: v.projectName || null,
        deliveryAddress: v.deliveryAddress || null,
        deliveryDate: v.deliveryDate ?? null,
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
          priceBookId: i.priceBookId,
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

      // Phiếu đặt hàng giữ số lượng tại kho nhưng chưa trừ tồn thực tế.
      if (isBooking) {
        for (const item of trustedItems) {
          for (const stockItem of item.stockItems) {
            const baseQty = stockItem.quantity;
            await tx.insert(stockLevels).values({
              productId: stockItem.productId,
              warehouseId: v.warehouseId,
              quantity: "0",
              reserved: toQty(baseQty),
            }).onConflictDoUpdate({
              target: [stockLevels.productId, stockLevels.warehouseId],
              set: {
                reserved: sql`${stockLevels.reserved} + ${toQty(baseQty)}`,
                updatedAt: sql`now()`,
              },
            });
          }
        }
        return { order, notification: null };
      }

      // Báo giá / đơn chờ thanh toán: chưa ảnh hưởng tồn kho hoặc công nợ doanh thu.
      if (isQuote || paymentPending) {
        return { order, notification: null };
      }

      // Trừ kho theo base unit + ghi movement
      for (const i of trustedItems) {
        for (const stockItem of i.stockItems) {
          const baseQty = stockItem.quantity;
          await consumeTrackedStockLots(tx, {
            productId: stockItem.productId,
            warehouseId: v.warehouseId,
            quantity: baseQty,
            refType: "order",
            refId: order.id,
            createdBy: profileId,
          });
          await tx
            .insert(stockLevels)
            .values({
              productId: stockItem.productId,
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
            productId: stockItem.productId,
            warehouseId: v.warehouseId,
            type: "sale",
            quantity: toQty(-baseQty),
            refType: "order",
            refId: order.id,
            note: `${order.code} · ${i.productName} · ${i.quantity} ${i.unitName}`,
            createdBy: profileId,
          });
        }
      }

      // Công nợ + tổng mua của khách
      if (v.customerId) {
        await tx.update(customers).set({
          currentDebt: sql`${customers.currentDebt} + ${toMoney(remaining)}`,
          totalSpent: sql`${customers.totalSpent} + ${toMoney(total)}`,
        }).where(eq(customers.id, v.customerId));
      }

      const notification = v.source?.mode === "edit"
        ? null
        : await createNotificationEventInTx(tx, {
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
              source: v.source?.mode ?? "sale",
            },
          });

      return { order, notification };
    });

    if (result.notification?.created) {
      await publishCommittedNotification(result.notification.eventId);
    }
    revalidateOrderPaths(v.source?.orderId);
    return { ok: true, data: result.order };
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
      INSUFFICIENT_BATCH_STOCK: "pos.errors.insufficientStock",
    };
    const msg = e instanceof Error ? e.message : "";
    if (known[msg]) return { ok: false, error: known[msg] };
    console.error("createOrder failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
