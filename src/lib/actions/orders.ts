"use server";

import { revalidatePath } from "next/cache";
import {
  type CreateOrderInput, type AddPaymentInput, createOrderSchema,
} from "@/lib/schemas/order";
import {
  type ActionResult, requireSalesAccess, requireManager,
} from "./common";
import { Routes } from "@/lib/routes";
import { createOrderForUser } from "@/lib/orders/create";
import { addPaymentForUser } from "@/lib/orders/payment";
import { convertQuoteToOrderForUser } from "@/lib/orders/convert";
import { cancelOrderForUser, cancelQuoteForUser } from "@/lib/orders/cancel";
import { normalizeOrderItems } from "@/lib/orders/normalize";
import {
  evaluateOrderApprovalRequirement,
  roleCanApproveOrderRequirement,
} from "@/lib/orders/sensitive-approval";
import { getRawStorePrefs } from "@/lib/data/settings";

export async function createOrder(
  input: CreateOrderInput
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  try {
    const trustedItems = await normalizeOrderItems(
      parsed.data.items,
      parsed.data.priceBookId,
    );
    const prefs = await getRawStorePrefs();
    const requirement = evaluateOrderApprovalRequirement({
      clientId: parsed.data.clientId,
      rawItems: parsed.data.items,
      trustedItems,
      orderDiscount: parsed.data.discount,
      maxDiscountPercent: prefs.security.maxDiscountPercent,
    });
    if (!roleCanApproveOrderRequirement(gate.role, requirement)) {
      return { ok: false, error: "errors.forbidden" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      [
        "PRODUCT_NOT_FOUND",
        "UNIT_NOT_FOUND",
        "INVALID_ITEMS",
        "SENSITIVE_ORDER_REQUIRES_CLIENT_ID",
      ].includes(message)
    ) {
      return { ok: false, error: "errors.invalidData" };
    }
    throw error;
  }
  // Lõi tách riêng. Xem src/lib/orders/create.ts.
  return createOrderForUser(gate.userId, parsed.data);
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
  const result = await convertQuoteToOrderForUser(gate.userId, quoteId);
  if (result.ok) {
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.Quotes);
    revalidatePath(Routes.Sales);
    revalidatePath(Routes.order(quoteId));
  }
  return result;
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
  const result = await cancelOrderForUser(gate.userId, orderId);
  if (result.ok) {
    revalidatePath(Routes.Orders);
    revalidatePath(Routes.order(orderId));
  }
  return result;
}
