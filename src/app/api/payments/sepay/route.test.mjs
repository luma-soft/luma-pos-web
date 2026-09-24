import { expect, mock, test } from "bun:test";

let capturedPaymentInput;
let capturedSessionInput;
const createdAt = new Date("2026-09-14T03:00:00.000Z");
const expiresAt = new Date("2026-09-14T03:10:00.000Z");

const account = {
  id: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  bankCode: "VPB",
  gateway: "VPBank",
  accountNumber: "123456789",
  subAccount: null,
  accountName: "HAI DANG",
};
const query = {
  from() { return this; },
  where() { return this; },
  orderBy() { return this; },
  async limit() { return [account]; },
};

mock.module("@/db", () => ({ db: { select: () => query } }));
mock.module("@/lib/actions/common", () => ({ getProfileId: async () => "profile-id" }));
mock.module("@/lib/mobile/auth", () => ({
  requireMobileSalesAccess: async () => ({
    ok: true,
    userId: "user-id",
    storeId: account.storeId,
    role: "owner",
    features: {},
  }),
}));
mock.module("@/lib/mobile/response", () => ({
  mobileAction: (value) => Response.json(value),
  mobileError: (error) => Response.json({ ok: false, error }, { status: 400 }),
  mobileGate: () => null,
  readJson: (request) => request.json(),
}));
mock.module("@/lib/payments/service", () => ({
  cancelDraftOrder: async () => ({ ok: true }),
  createPendingSepayPayment: async (input) => {
    capturedPaymentInput = input;
    return {
      ok: true,
      data: { id: "payment-id", reference: "LUMA260914123456A1B2", createdAt },
    };
  },
  createPendingSepayPaymentSession: async (input) => {
    capturedSessionInput = input;
    return {
      ok: true,
      data: {
        id: "session-id",
        reference: "LUMA260914123456C3D4",
        createdAt,
        expiresAt,
      },
    };
  },
}));
mock.module("@/lib/payments/service-core", () => ({
  SEPAY_PAYMENT_TIMEOUT_MS: 10 * 60 * 1000,
}));
mock.module("@/lib/payments/sepay", () => ({
  buildSepayVietQrImageUrl: () => "https://qr.sepay.vn/test.png",
}));

const { POST } = await import("./route");

test("treats a legacy mobile reference only as an idempotency key", async () => {
  capturedPaymentInput = undefined;
  const response = await POST(new Request("https://haidangshop.com/api/payments/sepay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      orderId: "33333333-3333-4333-8333-333333333333",
      amount: 500000,
      reference: "HD-260914-0001",
    }),
  }));

  expect(response.status).toBe(200);
  expect(capturedPaymentInput.clientRequestId).toBe("HD-260914-0001");
  expect(capturedPaymentInput.reference).toBeUndefined();
  expect((await response.json()).data.expiresAt).toBe("2026-09-14T03:10:00.000Z");
});

test("creates a QR session without creating an order", async () => {
  capturedSessionInput = undefined;
  capturedPaymentInput = undefined;
  const response = await POST(new Request("https://haidangshop.com/api/payments/sepay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      amount: 500000,
      clientRequestId: "web-pos:inv-1:1",
    }),
  }));

  expect(response.status).toBe(200);
  expect(capturedSessionInput).toMatchObject({
    storeId: account.storeId,
    bankAccountId: account.id,
    amount: 500000,
    clientRequestId: "web-pos:inv-1:1",
  });
  expect(capturedPaymentInput).toBeUndefined();
  expect((await response.json()).data.paymentId).toBe("session-id");
});
