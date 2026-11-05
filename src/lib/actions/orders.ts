"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import {
  type CreateOrderInput,
  type AddPaymentInput,
  cancelOrdersSchema,
  createOrderSchema,
} from "@/lib/schemas/order";
import {
  type ActionResult, requireSalesAccess, requireManager,
} from "./common";
import { Routes } from "@/lib/routes";
import { createOrderForUser } from "@/lib/orders/create";
import { addPaymentForUser } from "@/lib/orders/payment";
import { convertQuoteToOrderForUser, finalizeDraftOrderForUser } from "@/lib/orders/convert";
import { cancelOrderForUser, cancelQuoteForUser } from "@/lib/orders/cancel";
import { normalizeOrderItems } from "@/lib/orders/normalize";
import { CHECKOUT_PRICING_CHANGED, checkoutPriceMismatchIndexes } from "@/lib/orders/checkout-pricing";
import {
  evaluateOrderApprovalRequirement,
  roleCanApproveOrderRequirement,
} from "@/lib/orders/sensitive-approval";
import { getRawStorePrefs } from "@/lib/data/settings";
import type { StorePrefs } from "@/lib/schemas/settings";

export async function createOrder(
  input: CreateOrderInput
): Promise<ActionResult<{ id: string; code: string }>> {
  const gate = await requireSalesAccess();
  if (!gate.ok) return gate;
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  let orderInput = parsed.data;
  let trustedItems;
  let taxPrefs: StorePrefs["tax"] | undefined;
  let preservedInvoicePrice = false;
  try {
    trustedItems = await normalizeOrderItems(
      gate.storeId,
      orderInput.items,
      orderInput.priceBookId,
      gate.role,
    );
    const priceMismatchIndexes = checkoutPriceMismatchIndexes(orderInput, trustedItems);
    if (priceMismatchIndexes?.length) {
      let missingInvoicePrice = false;
      const adjustedItems = orderInput.items.map((item, index) => {
        if (!priceMismatchIndexes.includes(index) || item.manualUnitPrice != null) return item;
        if (item.invoiceUnitPrice == null) {
          missingInvoicePrice = true;
          return item;
        }
        preservedInvoicePrice = true;
        return { ...item, manualUnitPrice: item.invoiceUnitPrice };
      });
      if (missingInvoicePrice) {
        return { ok: false, error: CHECKOUT_PRICING_CHANGED };
      }
      orderInput = { ...orderInput, items: adjustedItems };
      trustedItems = await normalizeOrderItems(
        gate.storeId,
        orderInput.items,
        orderInput.priceBookId,
        gate.role,
      );
      const remainingPriceMismatches = checkoutPriceMismatchIndexes(orderInput, trustedItems);
      if (remainingPriceMismatches == null || remainingPriceMismatches.length > 0) {
        return { ok: false, error: CHECKOUT_PRICING_CHANGED };
      }
    }
    const prefs = await getRawStorePrefs(gate.storeId);
    taxPrefs = prefs.tax;
    const requirement = evaluateOrderApprovalRequirement({
      clientId: parsed.data.clientId,
      rawItems: orderInput.items,
      trustedItems,
      orderDiscount: orderInput.discount,
      maxDiscountPercent: prefs.security.maxDiscountPercent,
    });
    if (!roleCanApproveOrderRequirement(gate.role, requirement)) {
      return { ok: false, error: preservedInvoicePrice ? CHECKOUT_PRICING_CHANGED : "errors.forbidden" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNIT_NOT_SELLABLE") return { ok: false, error: "pos.errors.unitUnavailable" };
    if (orderInput.expectedPricing && ["PRICE_BOOK_PRICE_UNAVAILABLE", "PRODUCT_NOT_FOUND", "UNIT_NOT_FOUND", "PRICE_BOOK_NOT_FOUND"].includes(message)) {
      return { ok: false, error: CHECKOUT_PRICING_CHANGED };
    }
    if (message === "PRICE_BOOK_PRICE_UNAVAILABLE") return { ok: false, error: "pricing.errors.priceUnavailable" };
    if (message === "PRICE_BOOK_FORBIDDEN") return { ok: false, error: "errors.forbidden" };
    if (
      [
        "PRODUCT_NOT_FOUND",
        "PRICE_BOOK_NOT_FOUND",
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
  return createOrderForUser(gate.userId, orderInput, {
    items: trustedItems,
    taxPrefs,
  });
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
