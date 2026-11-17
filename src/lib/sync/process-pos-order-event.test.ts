import { beforeEach, describe, expect, mock, test } from "bun:test";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const createdPayloads: unknown[] = [];

mock.module("@/lib/auth/store-context", () => ({
  resolveStoreContextForUser: async () => ({ storeId: STORE_ID, role: "owner" }),
}));
mock.module("@/lib/orders/create-command", () => ({
  createOrderForSalesPrincipal: async (_principal: unknown, payload: unknown) => {
    createdPayloads.push(payload);
    return { ok: true, data: { id: "order-1", code: "HD000001" } };
  },
}));

mock.module("@/lib/orders/checkout-pricing", () => ({
  CHECKOUT_PRICING_CHANGED: "errors.checkoutPricingChanged",
}));

const { processPosOrderRelayEvent } = await import("./process-pos-order-event");

const payload = {
  mode: "sale",
  items: [{
    quantity: 1,
    unitName: "cái",
    productId: "ae77e40f-0647-45c4-9e36-8d8dfcca5b83",
    productName: "Van Cửa PPR",
    lineDiscount: 0,
    unitMultiplier: 1,
    invoiceUnitPrice: 190000,
  }],
  payment: { amount: 190000, method: "cash" },
  taxRate: 0,
  clientId: "1794909055363-pnsqy8g",
  discount: 0,
  projectId: null,
  customerId: null,
  taxEnabled: false,
  priceBookId: null,
  shippingFee: 0,
  warehouseId: "0683224d-2114-4f25-93a4-d7a90a3a344f",
  paymentPending: false,
  expectedPricing: {
    version: 1,
    lines: [{ unitName: "cái", productId: "ae77e40f-0647-45c4-9e36-8d8dfcca5b83", unitPrice: 190000, unitMultiplier: 1 }],
  },
};

const baseInput = {
  eventId: "37a4b2a8-6dc3-8ff3-b830-b83416a3655d",
  storeId: STORE_ID,
  userId: "bc7c7ce1-c3b1-4c45-a964-ae8156b4f4da",
  deviceId: "d66ad100-4d6e-493d-b77d-469391462479",
  payload,
};

describe("processPosOrderRelayEvent", () => {
  beforeEach(() => {
    createdPayloads.length = 0;
  });

  test("accepts a stored event whose base_revision column is NULL", async () => {
    const result = await processPosOrderRelayEvent({ ...baseInput, baseRevision: null });
    expect(result).toEqual({ status: "accepted", result: { id: "order-1", code: "HD000001" }, errorCode: null });
    expect(createdPayloads).toHaveLength(1);
  });

  test("still accepts a numeric-string base revision", async () => {
    const result = await processPosOrderRelayEvent({ ...baseInput, baseRevision: "42" });
    expect(result.status).toBe("accepted");
  });

  test("rejects a malformed base revision", async () => {
    const result = await processPosOrderRelayEvent({ ...baseInput, baseRevision: "-1" });
    expect(result).toEqual({ status: "rejected", result: null, errorCode: "SYNC_EVENT_INVALID" });
    expect(createdPayloads).toHaveLength(0);
  });
});
