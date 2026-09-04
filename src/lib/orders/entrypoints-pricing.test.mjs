import { beforeEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";

const productId = randomUUID(), storeId = randomUUID(), userId = randomUUID();
let gate, normalizationError, result, calls, approvalAllowed;
const trustedItems = [{ productId, unitName: "cây", unitMultiplier: 4, quantity: 2,
  preDiscountUnitPrice: 45000, lineDiscount: 0, unitPrice: 45000, total: 90000 }];
mock.module("@/lib/orders/normalize", () => ({ normalizeOrderItems: async () => {
  if (normalizationError) throw new Error(normalizationError);
  return trustedItems;
} }));
mock.module("@/lib/orders/create", () => ({ createOrderForUser: async (...args) => {
  calls.push(args); return result;
} }));
mock.module("@/lib/mobile/auth", () => ({ requireMobileSalesAccess: async () => gate }));
mock.module("@/lib/actions/common", () => ({ requireSalesAccess: async () => gate, requireManager: async () => gate }));
mock.module("@/lib/auth/mobile-approval", () => ({ authorizeMobileSensitiveAction: async () => approvalAllowed
  ? { ok: true } : { ok: false, error: "errors.forbidden" } }));
mock.module("@/lib/data/settings", () => ({ getRawStorePrefs: async () => ({ security: { maxDiscountPercent: 20 } }) }));
mock.module("@/lib/data/orders", () => ({ getOrders: async () => [] }));
mock.module("@/lib/sync/revalidate-app-data", () => ({ revalidateAppData() {} }));
mock.module("@/lib/orders/payment", () => ({ addPaymentForUser() {} }));
mock.module("@/lib/orders/convert", () => ({ convertQuoteToOrderForUser() {} }));
mock.module("@/lib/orders/cancel", () => ({ cancelOrderForUser() {}, cancelQuoteForUser() {} }));
const { POST } = await import("../../app/api/mobile/orders/route");
const { createOrder } = await import("../actions/orders");
const input = () => ({ clientId: randomUUID(), warehouseId: randomUUID(),
  items: [{ productId, unitName: "cây", quantity: 2 }], payment: { method: "cash", amount: 90000 },
  expectedPricing: { version: 1, lines: [{ productId, unitName: "cây", unitMultiplier: 4, unitPrice: 45000 }] },
});
const mobile = (body) => POST(new Request("http://localhost/api/mobile/orders", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));
beforeEach(() => {
  gate = { ok: true, userId, storeId, role: "owner" };
  normalizationError = null; calls = []; approvalAllowed = true;
  result = { ok: true, data: { id: randomUUID(), code: "HD001" } };
});

test("both entrypoints hand off the parsed expectation and server-only authorization snapshot", async () => {
  const body = input();
  body.authorization = { items: [{ unitPrice: 1 }] }; // Never trusted from JSON.
  expect(await createOrder(body)).toEqual(result);
  expect((await mobile(body)).status).toBe(200);
  for (const [actor, value, authorization] of calls) {
    expect(actor).toBe(userId);
    expect(value.expectedPricing).toEqual(body.expectedPricing);
    expect(value.authorization).toBeUndefined();
    expect(authorization.items).toBe(trustedItems);
  }
});

test("atomic conflicts use HTTP 409 on mobile and the same action error on web", async () => {
  result = { ok: false, error: "pos.errors.pricingChanged" };
  const response = await mobile(input());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual(result);
  expect(await createOrder(input())).toEqual(result);
});

for (const missing of ["PRODUCT_NOT_FOUND", "UNIT_NOT_FOUND", "PRICE_BOOK_NOT_FOUND", "PRICE_BOOK_PRICE_UNAVAILABLE"]) {
  test(`${missing} becomes a conflict only for guarded requests`, async () => {
    normalizationError = missing;
    expect((await mobile(input())).status).toBe(409);
    expect(await createOrder(input())).toEqual({ ok: false, error: "pos.errors.pricingChanged" });
    const legacy = input(); delete legacy.expectedPricing;
    const expected = missing === "PRICE_BOOK_PRICE_UNAVAILABLE" ? "pricing.errors.priceUnavailable" : "errors.invalidData";
    const response = await mobile(legacy);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: expected });
    expect(await createOrder(legacy)).toEqual({ ok: false, error: expected });
    expect(calls).toHaveLength(0);
  });
}

test("a snapshot cannot bypass authentication, forbidden books or manual-price approval", async () => {
  gate = { ok: false, error: "errors.unauthorized" };
  expect((await mobile(input())).status).toBe(401);
  expect(await createOrder(input())).toEqual(gate);
  gate = { ok: true, userId, storeId, role: "cashier" };
  normalizationError = "PRICE_BOOK_FORBIDDEN";
  expect((await mobile(input())).status).toBe(403);
  expect(await createOrder(input())).toEqual({ ok: false, error: "errors.forbidden" });
  normalizationError = null; approvalAllowed = false;
  const manual = input(); manual.items[0].manualUnitPrice = 45000;
  expect((await mobile(manual)).status).toBe(403);
  expect(await createOrder(manual)).toEqual({ ok: false, error: "errors.forbidden" });
  expect(calls).toHaveLength(0);
});

test("malformed or reordered snapshots never reach order creation", async () => {
  const body = input(); body.expectedPricing.lines[0].productId = randomUUID();
  expect((await mobile(body)).status).toBe(400);
  expect(await createOrder(body)).toEqual({ ok: false, error: "errors.invalidData" });
  expect(calls).toHaveLength(0);
});
