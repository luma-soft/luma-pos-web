"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import {
  type CreateOrderInput,
  type AddPaymentInput,
  cancelOrdersSchema,
} from "@/lib/schemas/order";
import {
  type ActionResult, requireSalesAccess, requireManager,
} from "./common";
import { Routes } from "@/lib/routes";
import { createOrderForSalesPrincipal } from "@/lib/orders/create-command";
import { addPaymentForUser } from "@/lib/orders/payment";
import { convertQuoteToOrderForUser, finalizeDraftOrderForUser } from "@/lib/orders/convert";
import { cancelOrderForUser, cancelQuoteForUser } from "@/lib/orders/cancel";

export async function createOrder(
  input: CreateOrderInput
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  return createOrderForSalesPrincipal(gate, input);
}

export async function addPayment(input: AddPaymentInput): Promise<ActionResult> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  // Lõi tách riêng. Xem src/lib/orders/payment.ts.
  return addPaymentForUser(gate.userId, input);
}

/** Chốt báo giá thành đơn: trừ kho + ghi nợ. Thu tiền sau qua addPayment. */
export async function convertQuoteToOrder(quoteId: string): Promise<ActionResult<{ code: string }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  // Lõi tách riêng. Xem src/lib/orders/convert.ts.
  const result = await convertQuoteToOrderForUser(gate.userId, gate.storeId, quoteId);
  if (result.ok) {
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Quotes);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.order(quoteId));
  }
  return result;
}

/** Chốt đơn nháp thành hóa đơn bán hàng: trừ kho và ghi công nợ nếu còn nợ. */
export async function createInvoiceFromDraft(orderId: string): Promise<ActionResult<{ code: string }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  return finalizeDraftOrderForUser(gate.userId, gate.storeId, orderId);
}

/** Hủy báo giá (không ảnh hưởng kho/nợ). */
export async function cancelQuote(quoteId: string): Promise<ActionResult> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  const result = await cancelQuoteForUser(gate.userId, quoteId);
  if (result.ok) {
    revalidatePath(Routes.Quotes);
  }
  return result;
}

export async function cancelOrder(orderId: string): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const result = await cancelOrderForUser(gate.userId, gate.storeId, orderId);
  if (result.ok) {
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.order(orderId));
  }
  return result;
}

/** Hủy nhiều đơn theo best-effort; các đơn lỗi được giữ lại để UI cho thử lại. */
export async function cancelOrders(
  orderIds: string[],
): Promise<ActionResult<{ cancelled: number; failedIds: string[] }>> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = cancelOrdersSchema.safeParse(orderIds);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };

  let cancelled = 0;
  const failedIds: string[] = [];
  for (const orderId of parsed.data) {
    const result = await cancelOrderForUser(
      gate.userId,
      gate.storeId,
      orderId,
    );
    if (result.ok) cancelled += 1;
    else failedIds.push(orderId);
  }

  if (cancelled > 0) {
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Sales);
  }
  return { ok: true, data: { cancelled, failedIds } };
}
