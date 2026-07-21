import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  createGatewayIntent,
  createGatewayRefund,
  queryGatewayPayment,
  queryGatewayRefund,
  resolveGatewayConfig,
} from "../src/lib/payments/gateway-adapter";

const baseEnv = {
  PAYMENT_CALLBACK_BASE_URL: "https://pos.example",
  PAYMENT_GATEWAY_ENV: "sandbox",
};

describe("payment gateway HTTP adapters", () => {
  test("MoMo verifies its create response before exposing provider URLs", async () => {
    const config = resolveGatewayConfig("momo", {
      ...baseEnv,
      MOMO_PARTNER_CODE: "MOMO_TEST",
      MOMO_ACCESS_KEY: "access",
      MOMO_SECRET_KEY: "secret",
    });
    expect(config?.provider).toBe("momo");
    const response = {
      partnerCode: "MOMO_TEST",
      orderId: "LUMA-MOMO-001",
      requestId: "payment-id-001",
      amount: 100000,
      responseTime: 1721720619912,
      message: "Successful.",
      resultCode: 0,
      payUrl: "https://test-payment.momo.vn/v2/gateway/pay?t=signed",
      deeplink: "momo://pay/signed",
      qrCodeUrl: "000201010212",
    };
    const raw = "accessKey=access&amount=100000&orderId=LUMA-MOMO-001&partnerCode=MOMO_TEST&payUrl=https://test-payment.momo.vn/v2/gateway/pay?t=signed&requestId=payment-id-001&responseTime=1721720619912&resultCode=0";
    const fetcher: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://test-payment.momo.vn/v2/gateway/api/create");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        orderId: "LUMA-MOMO-001",
        requestId: "payment-id-001",
        requestType: "captureWallet",
      });
      return Response.json({
        ...response,
        signature: createHmac("sha256", "secret").update(raw).digest("hex"),
      });
    };
    const result = await createGatewayIntent(config!, {
      paymentId: "payment-id-001",
      reference: "LUMA-MOMO-001",
      orderCode: "DH001",
      amount: 100000,
      actorId: "cashier-1",
      ipAddress: "127.0.0.1",
    }, fetcher);
    expect(result).toMatchObject({
      ok: true,
      checkoutUrl: response.payUrl,
      deepLink: response.deeplink,
      qrPayload: response.qrCodeUrl,
      providerStatus: "0",
    });
  });

  test("MoMo rejects a forged create response", async () => {
    const config = resolveGatewayConfig("momo", {
      ...baseEnv,
      MOMO_PARTNER_CODE: "MOMO_TEST",
      MOMO_ACCESS_KEY: "access",
      MOMO_SECRET_KEY: "secret",
    })!;
    const result = await createGatewayIntent(config, {
      paymentId: "payment-id-002",
      reference: "LUMA-MOMO-002",
      orderCode: "DH002",
      amount: 100000,
      actorId: "cashier-1",
      ipAddress: "127.0.0.1",
    }, async () => Response.json({
      partnerCode: "MOMO_TEST",
      orderId: "LUMA-MOMO-002",
      requestId: "payment-id-002",
      amount: 100000,
      responseTime: 1,
      resultCode: 0,
      payUrl: "https://evil.example/pay",
      signature: "00".repeat(32),
    }));
    expect(result).toMatchObject({ ok: false, retryable: false, error: "payments.errors.invalidProviderSignature" });
  });

  test("ZaloPay posts the signed form and accepts only its HTTPS checkout host", async () => {
    const config = resolveGatewayConfig("zalopay", {
      ...baseEnv,
      ZALOPAY_APP_ID: "2553",
      ZALOPAY_KEY1: "one",
      ZALOPAY_KEY2: "two",
    })!;
    const result = await createGatewayIntent(config, {
      paymentId: "payment-id-003",
      reference: "260719_LUMA003",
      orderCode: "DH003",
      amount: 78000,
      actorId: "cashier-1",
      ipAddress: "127.0.0.1",
    }, async (url, init) => {
      expect(String(url)).toBe("https://sb-openapi.zalopay.vn/v2/create");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("app_trans_id")).toBe("260719_LUMA003");
      expect(body.get("mac")).toHaveLength(64);
      return Response.json({
        return_code: 1,
        return_message: "Giao dịch thành công",
        sub_return_code: 1,
        order_url: "https://sbgateway.zalopay.vn/openinapp?order=003",
        zp_trans_token: "token-003",
      });
    });
    expect(result).toMatchObject({ ok: true, providerStatus: "1" });
    expect(result.ok && result.checkoutUrl).toContain("zalopay.vn");
  });

  test("VNPAY adapter is local URL generation and never calls fetch", async () => {
    const config = resolveGatewayConfig("vnpay", {
      ...baseEnv,
      VNPAY_TMN_CODE: "LUMATEST",
      VNPAY_HASH_SECRET: "secret",
    })!;
    let called = false;
    const result = await createGatewayIntent(config, {
      paymentId: "payment-id-004",
      reference: "LUMAVNP004",
      orderCode: "DH004",
      amount: 155000,
      actorId: "cashier-1",
      ipAddress: "127.0.0.1",
    }, async () => {
      called = true;
      return Response.json({});
    });
    expect(called).toBe(false);
    expect(result.ok && result.checkoutUrl).toContain("sandbox.vnpayment.vn/paymentv2/vpcpay.html");
  });

  test("normalizes MoMo inquiry success and pending without optimistic settlement", async () => {
    const config = resolveGatewayConfig("momo", {
      ...baseEnv,
      MOMO_PARTNER_CODE: "MOMO_TEST",
      MOMO_ACCESS_KEY: "access",
      MOMO_SECRET_KEY: "secret",
    })!;
    const success = await queryGatewayPayment(config, {
      paymentId: "payment-query-001",
      reference: "LUMA-MOMO-QUERY",
      orderCode: "DH-QUERY",
      amount: 100000,
      createdAt: new Date("2026-07-19T03:30:00Z"),
      ipAddress: "127.0.0.1",
    }, async (url, init) => {
      expect(String(url)).toBe("https://test-payment.momo.vn/v2/gateway/api/query");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        orderId: "LUMA-MOMO-QUERY",
        requestId: "payment-query-001",
      });
      return Response.json({
        partnerCode: "MOMO_TEST",
        requestId: "payment-query-001",
        orderId: "LUMA-MOMO-QUERY",
        amount: 100000,
        transId: 987654321,
        resultCode: 0,
        responseTime: 1721360100000,
      });
    });
    expect(success).toMatchObject({
      ok: true,
      state: "confirmed",
      reference: "LUMA-MOMO-QUERY",
      amount: 100000,
      providerTransactionId: "987654321",
    });

    const pending = await queryGatewayPayment(config, {
      paymentId: "payment-query-002",
      reference: "LUMA-MOMO-PENDING",
      orderCode: "DH-PENDING",
      amount: 100000,
      createdAt: new Date("2026-07-19T03:30:00Z"),
      ipAddress: "127.0.0.1",
    }, async () => Response.json({
      partnerCode: "MOMO_TEST",
      requestId: "payment-query-002",
      orderId: "LUMA-MOMO-PENDING",
      amount: 100000,
      resultCode: 1000,
      responseTime: 1721360100000,
    }));
    expect(pending).toMatchObject({ ok: true, state: "pending", providerStatus: "1000" });
  });

  test("normalizes ZaloPay processing and VNPAY signed inquiry success", async () => {
    const zaloConfig = resolveGatewayConfig("zalopay", {
      ...baseEnv,
      ZALOPAY_APP_ID: "2553",
      ZALOPAY_KEY1: "one",
      ZALOPAY_KEY2: "two",
    })!;
    const zalo = await queryGatewayPayment(zaloConfig, {
      paymentId: "payment-query-003",
      reference: "260719_LUMAQUERY",
      orderCode: "DH-ZALO",
      amount: 78000,
      createdAt: new Date("2026-07-19T03:30:00Z"),
      ipAddress: "127.0.0.1",
    }, async (url, init) => {
      expect(String(url)).toBe("https://sb-openapi.zalopay.vn/v2/query");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("mac")).toHaveLength(64);
      return Response.json({ return_code: 3, return_message: "Processing", is_processing: true });
    });
    expect(zalo).toMatchObject({ ok: true, state: "pending", providerStatus: "3" });

    const vnpConfig = resolveGatewayConfig("vnpay", {
      ...baseEnv,
      VNPAY_TMN_CODE: "LUMATEST",
      VNPAY_HASH_SECRET: "vnp-secret",
    })!;
    const vnpay = await queryGatewayPayment(vnpConfig, {
      paymentId: "payment-query-004",
      reference: "LUMAVQUERY004",
      orderCode: "DH004",
      amount: 155000,
      createdAt: new Date("2026-07-19T03:30:00Z"),
      ipAddress: "127.0.0.1",
    }, async (url) => {
      expect(String(url)).toBe("https://sandbox.vnpayment.vn/merchant_webapi/api/transaction");
      const response = {
        vnp_ResponseId: "RESPONSE0004",
        vnp_Command: "querydr",
        vnp_ResponseCode: "00",
        vnp_Message: "Success",
        vnp_TmnCode: "LUMATEST",
        vnp_TxnRef: "LUMAVQUERY004",
        vnp_Amount: "15500000",
        vnp_BankCode: "NCB",
        vnp_PayDate: "20260719103500",
        vnp_TransactionNo: "14567894",
        vnp_TransactionType: "01",
        vnp_TransactionStatus: "00",
        vnp_OrderInfo: "Query DH004",
        vnp_PromotionCode: "",
        vnp_PromotionAmount: "",
      };
      const raw = Object.values(response).join("|");
      return Response.json({
        ...response,
        vnp_SecureHash: createHmac("sha512", "vnp-secret").update(raw).digest("hex"),
      });
    });
    expect(vnpay).toMatchObject({
      ok: true,
      state: "confirmed",
      amount: 155000,
      providerTransactionId: "14567894",
    });
  });

  test("keeps asynchronous ZaloPay refund pending until refund query confirms", async () => {
    const config = resolveGatewayConfig("zalopay", {
      ...baseEnv,
      ZALOPAY_APP_ID: "2553",
      ZALOPAY_KEY1: "one",
      ZALOPAY_KEY2: "two",
    })!;
    const input = {
      refundId: "refund-id-001",
      reference: "260719_2553_RF001",
      sourceReference: "260719_LUMA001",
      sourceProviderTransactionId: "240719000001",
      amount: 50_000,
      originalAmount: 100_000,
      paymentCreatedAt: new Date("2026-07-19T03:30:00Z"),
      actorId: "manager-1",
      ipAddress: "127.0.0.1",
      description: "Refund TH001",
    };
    const created = await createGatewayRefund(config, input, async (url, init) => {
      expect(String(url)).toBe("https://sb-openapi.zalopay.vn/v2/refund");
      expect(new URLSearchParams(String(init?.body)).get("mac")).toHaveLength(64);
      return Response.json({ return_code: 1, refund_id: 99112233 });
    });
    expect(created).toMatchObject({ ok: true, state: "pending", providerTransactionId: "99112233" });

    const queried = await queryGatewayRefund(config, input, async (url, init) => {
      expect(String(url)).toBe("https://sb-openapi.zalopay.vn/v2/query_refund");
      expect(new URLSearchParams(String(init?.body)).get("mac")).toHaveLength(64);
      return Response.json({ return_code: 1, refund_status: 1, refund_id: 99112233 });
    });
    expect(queried).toMatchObject({ ok: true, state: "confirmed", amount: 50000, providerTransactionId: "99112233" });
  });

  test("rejects forged VNPAY refund response", async () => {
    const config = resolveGatewayConfig("vnpay", {
      ...baseEnv,
      VNPAY_TMN_CODE: "LUMATEST",
      VNPAY_HASH_SECRET: "vnp-secret",
    })!;
    const result = await createGatewayRefund(config, {
      refundId: "refund-id-002",
      reference: "RF-VNPAY-002",
      sourceReference: "LUMAVPAY002",
      sourceProviderTransactionId: "14567890",
      amount: 50_000,
      originalAmount: 100_000,
      paymentCreatedAt: new Date("2026-07-19T03:30:00Z"),
      actorId: "manager-1",
      ipAddress: "127.0.0.1",
      description: "Refund TH002",
    }, async () => Response.json({
      vnp_ResponseId: "R2",
      vnp_Command: "refund",
      vnp_ResponseCode: "00",
      vnp_TmnCode: "LUMATEST",
      vnp_TxnRef: "LUMAVPAY002",
      vnp_Amount: "5000000",
      vnp_TransactionNo: "9988",
      vnp_TransactionType: "03",
      vnp_TransactionStatus: "00",
      vnp_SecureHash: "00".repeat(64),
    }));
    expect(result).toMatchObject({ ok: false, retryable: false, error: "payments.errors.invalidProviderSignature" });
  });
});
