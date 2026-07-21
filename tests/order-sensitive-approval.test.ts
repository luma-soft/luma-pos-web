import { describe, expect, test } from "bun:test";
import {
  evaluateOrderApprovalRequirement,
  roleCanApproveOrderRequirement,
} from "../src/lib/orders/sensitive-approval";

const trustedLine = {
  quantity: 2,
  preDiscountUnitPrice: 100_000,
  lineDiscount: 0,
};

describe("mobile order sensitive approval", () => {
  test("does not require approval at the configured discount limit", () => {
    expect(evaluateOrderApprovalRequirement({
      clientId: "mobile-order-1",
      rawItems: [{ quantity: 2 }],
      trustedItems: [trustedLine],
      orderDiscount: 20_000,
      maxDiscountPercent: 10,
    })).toBeNull();
  });

  test("requires discount approval only when the trusted total exceeds the limit", () => {
    expect(evaluateOrderApprovalRequirement({
      clientId: "mobile-order-2",
      rawItems: [{ quantity: 2 }],
      trustedItems: [trustedLine],
      orderDiscount: 20_001,
      maxDiscountPercent: 10,
    })).toEqual({
      permission: "discount.override_limit",
      scope: "order:mobile-order-2",
    });
  });

  test("manual price requires price approval and legacy unitPrice is ignored", () => {
    expect(evaluateOrderApprovalRequirement({
      clientId: "mobile-order-3",
      rawItems: [{ quantity: 2, manualUnitPrice: 90_000 }],
      trustedItems: [trustedLine],
      orderDiscount: 0,
      maxDiscountPercent: 10,
    })).toEqual({
      permission: "price.override",
      scope: "order:mobile-order-3",
    });

    expect(evaluateOrderApprovalRequirement({
      clientId: "mobile-order-4",
      rawItems: [{ quantity: 2, unitPrice: 1 }],
      trustedItems: [trustedLine],
      orderDiscount: 0,
      maxDiscountPercent: 10,
    })).toBeNull();
  });

  test("sensitive orders require a stable client id for approval scope", () => {
    expect(() => evaluateOrderApprovalRequirement({
      rawItems: [{ quantity: 2, manualUnitPrice: 90_000 }],
      trustedItems: [trustedLine],
      orderDiscount: 0,
      maxDiscountPercent: 10,
    })).toThrow("SENSITIVE_ORDER_REQUIRES_CLIENT_ID");
  });

  test("server boundaries reject cashier sensitive pricing without a manager", () => {
    const requirement = {
      permission: "price.override" as const,
      scope: "order:web-order-1",
    };

    expect(roleCanApproveOrderRequirement("cashier", requirement)).toBe(false);
    expect(roleCanApproveOrderRequirement("warehouse", requirement)).toBe(false);
    expect(roleCanApproveOrderRequirement("manager", requirement)).toBe(true);
    expect(roleCanApproveOrderRequirement("owner", requirement)).toBe(true);
    expect(roleCanApproveOrderRequirement("cashier", null)).toBe(true);
  });
});
