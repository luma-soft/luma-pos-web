import type { StoreContext } from "@/lib/auth/store-context";
import { SALES_ACCESS_ROLES } from "@/lib/auth/roles";
import { getRawStorePrefs } from "@/lib/data/settings";
import { createOrderForUser } from "@/lib/orders/create";
import { normalizeOrderItems } from "@/lib/orders/normalize";
import { CHECKOUT_PRICING_CHANGED, checkoutPriceMismatchIndexes } from "@/lib/orders/checkout-pricing";
import {
  evaluateOrderApprovalRequirement,
  roleCanApproveOrderRequirement,
} from "@/lib/orders/sensitive-approval";
import type { NormalizedOrderItem } from "@/lib/orders/normalize";
import { createOrderSchema, type CreateOrderInput } from "@/lib/schemas/order";
import type { StorePrefs } from "@/lib/schemas/settings";
import type { ActionResult } from "@/lib/actions/common";

type SalesPrincipal = Pick<StoreContext, "userId" | "storeId" | "role">;

function isSalesAccessRole(role: StoreContext["role"]): role is (typeof SALES_ACCESS_ROLES)[number] {
  return (SALES_ACCESS_ROLES as readonly string[]).includes(role);
}

/** Shared trusted command path for authenticated web writes and Mac relay processing. */
export async function createOrderForSalesPrincipal(
  principal: SalesPrincipal,
  input: CreateOrderInput,
): Promise<ActionResult<{ id: string; code: string }>> {
  if (!isSalesAccessRole(principal.role)) {
    return { ok: false, error: "errors.forbidden" };
  }

  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  let orderInput = parsed.data;
  let trustedItems: NormalizedOrderItem[];
  let taxPrefs: StorePrefs["tax"];
  let preservedInvoicePrice = false;
  try {
    trustedItems = await normalizeOrderItems(
      principal.storeId,
      orderInput.items,
      orderInput.priceBookId,
      principal.role,
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
        principal.storeId,
        orderInput.items,
        orderInput.priceBookId,
        principal.role,
      );
      const remainingPriceMismatches = checkoutPriceMismatchIndexes(orderInput, trustedItems);
      if (remainingPriceMismatches == null || remainingPriceMismatches.length > 0) {
        return { ok: false, error: CHECKOUT_PRICING_CHANGED };
      }
    }
    const prefs = await getRawStorePrefs(principal.storeId);
    taxPrefs = prefs.tax;
    const requirement = evaluateOrderApprovalRequirement({
      clientId: parsed.data.clientId,
      rawItems: orderInput.items,
      trustedItems,
      orderDiscount: orderInput.discount,
      maxDiscountPercent: prefs.security.maxDiscountPercent,
    });
    if (!roleCanApproveOrderRequirement(principal.role, requirement)) {
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
    if (["PRODUCT_NOT_FOUND", "PRICE_BOOK_NOT_FOUND", "UNIT_NOT_FOUND", "INVALID_ITEMS", "SENSITIVE_ORDER_REQUIRES_CLIENT_ID"].includes(message)) {
      return { ok: false, error: "errors.invalidData" };
    }
    throw error;
  }

  return createOrderForUser(principal.userId, orderInput, {
    items: trustedItems,
    taxPrefs,
  });
}
