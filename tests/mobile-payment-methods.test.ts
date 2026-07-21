import { describe, expect, test } from "bun:test";
import { buildMobilePaymentMethods } from "../src/lib/payments/mobile-methods";
import { addPaymentSchema } from "../src/lib/schemas/order";

describe("mobile payment method capabilities", () => {
  test("uses store preferences and exposes configured VietQR", () => {
    const methods = buildMobilePaymentMethods({
      prefs: {
        cash: true,
        qr: true,
        card: false,
        momo: true,
        zalopay: false,
        vnpay: false,
        credit: true,
      },
      hasSepayAccount: true,
      gatewayAvailability: { momo: true, zalopay: false, vnpay: false },
    });

    expect(methods.find((method) => method.id === "cash")).toMatchObject({
      enabled: true,
      available: true,
      settlement: "manual_confirmed",
    });
    expect(methods.find((method) => method.id === "qr")).toMatchObject({
      enabled: true,
      available: true,
      settlement: "sepay_pending",
    });
    expect(methods.find((method) => method.id === "card")?.enabled).toBe(false);
    expect(methods.find((method) => method.id === "momo")).toMatchObject({
      enabled: true,
      available: true,
      settlement: "gateway_pending",
    });
  });

  test("does not silently enable unconfigured gateways", () => {
    const methods = buildMobilePaymentMethods({
      prefs: {
        cash: true,
        qr: true,
        card: true,
        momo: true,
        zalopay: true,
        vnpay: true,
        credit: true,
      },
      hasSepayAccount: false,
      gatewayAvailability: { momo: false, zalopay: false, vnpay: false },
    });

    expect(methods.find((method) => method.id === "qr")).toMatchObject({
      enabled: true,
      available: false,
      unavailableReason: "payments.errors.bankAccountNotFound",
    });
    for (const id of ["momo", "zalopay", "vnpay"]) {
      expect(methods.find((method) => method.id === id)).toMatchObject({
        enabled: true,
        available: false,
        unavailableReason: "payments.errors.providerNotConfigured",
      });
    }
  });

  test("follow-up payments reject provider methods that require confirmation", () => {
    const base = {
      orderId: "00000000-0000-4000-8000-000000000001",
      amount: 100_000,
    };
    expect(addPaymentSchema.safeParse({ ...base, method: "cash" }).success)
      .toBe(true);
    for (const method of ["qr", "momo", "zalopay", "vnpay"]) {
      expect(addPaymentSchema.safeParse({ ...base, method }).success)
        .toBe(false);
    }
  });
});
