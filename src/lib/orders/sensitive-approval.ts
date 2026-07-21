import type { MobilePermission } from "@/lib/auth/mobile-permissions";

type RawPricingLine = {
  quantity: number;
  unitPrice?: number;
  manualUnitPrice?: number;
};

type TrustedPricingLine = {
  quantity: number;
  preDiscountUnitPrice: number;
  lineDiscount: number;
};

export type OrderApprovalRequirement = {
  permission: Extract<MobilePermission, "price.override" | "discount.override_limit">;
  scope: string;
};

export function roleCanApproveOrderRequirement(
  role: "owner" | "manager" | "cashier" | "warehouse",
  requirement: OrderApprovalRequirement | null,
) {
  return requirement == null || role === "owner" || role === "manager";
}

export function evaluateOrderApprovalRequirement(input: {
  clientId?: string | null;
  rawItems: RawPricingLine[];
  trustedItems: TrustedPricingLine[];
  orderDiscount: number;
  maxDiscountPercent: number;
}): OrderApprovalRequirement | null {
  const hasManualPrice = input.rawItems.some(
    (item) => item.manualUnitPrice != null,
  );
  const grossSubtotal = input.trustedItems.reduce(
    (sum, item) => sum + item.quantity * item.preDiscountUnitPrice,
    0,
  );
  const lineDiscount = input.trustedItems.reduce(
    (sum, item) =>
      sum +
      item.quantity *
        Math.min(item.preDiscountUnitPrice, Math.max(0, item.lineDiscount)),
    0,
  );
  const totalDiscount = lineDiscount + Math.max(0, input.orderDiscount);
  const discountPercent = grossSubtotal > 0
    ? (totalDiscount / grossSubtotal) * 100
    : 0;
  const exceedsDiscountLimit = discountPercent > input.maxDiscountPercent;

  if (!hasManualPrice && !exceedsDiscountLimit) return null;
  const clientId = input.clientId?.trim();
  if (!clientId) throw new Error("SENSITIVE_ORDER_REQUIRES_CLIENT_ID");
  return {
    permission: hasManualPrice
      ? "price.override"
      : "discount.override_limit",
    scope: `order:${clientId}`,
  };
}
