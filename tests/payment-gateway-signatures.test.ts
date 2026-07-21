import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  buildMomoCreatePayload,
  buildMomoQueryPayload,
  buildMomoRefundPayload,
  buildVnpayPaymentUrl,
  buildVnpayQueryPayload,
  buildVnpayRefundPayload,
  buildZaloPayCreatePayload,
  buildZaloPayQueryPayload,
  buildZaloPayRefundPayload,
  resolveGatewayAvailability,
  verifyMomoIpn,
  verifyVnpayIpn,
  verifyVnpayQueryResponse,
  verifyZaloPayCallback,
} from "../src/lib/payments/gateways";

describe("payment gateway signatures", () => {
  test("builds the official MoMo captureWallet signature and rejects tampering", () => {
    const request = buildMomoCreatePayload({
      config: {
        partnerCode: "MOMO_TEST",
        accessKey: "access-key",
        secretKey: "secret-key",
      },
      amount: 125_000,
      orderId: "LUMA-MOMO-001",
      requestId: "request-001",
      orderInfo: "Thanh toan DH001",
      redirectUrl: "https://pos.example/payments/return",
      ipnUrl: "https://pos.example/api/payments/momo/ipn",
      extraData: "",
    });
    const raw = "accessKey=access-key&amount=125000&extraData=&ipnUrl=https://pos.example/api/payments/momo/ipn&orderId=LUMA-MOMO-001&orderInfo=Thanh toan DH001&partnerCode=MOMO_TEST&redirectUrl=https://pos.example/payments/return&requestId=request-001&requestType=captureWallet";
    expect(request.signature).toBe(createHmac("sha256", "secret-key").update(raw).digest("hex"));
    expect(request.requestType).toBe("captureWallet");

    const ipn = {
      partnerCode: "MOMO_TEST",
      orderId: "LUMA-MOMO-001",
      requestId: "request-001",
      amount: 125000,
      orderInfo: "Thanh toan DH001",
      orderType: "momo_wallet",
      transId: 987654321,
      resultCode: 0,
      message: "Successful.",
      payType: "qr",
      responseTime: 1721720663942,
      extraData: "",
    };
    const ipnRaw = "accessKey=access-key&amount=125000&extraData=&message=Successful.&orderId=LUMA-MOMO-001&orderInfo=Thanh toan DH001&orderType=momo_wallet&partnerCode=MOMO_TEST&payType=qr&requestId=request-001&responseTime=1721720663942&resultCode=0&transId=987654321";
    const signature = createHmac("sha256", "secret-key").update(ipnRaw).digest("hex");
    expect(verifyMomoIpn({ ...ipn, signature }, { accessKey: "access-key", secretKey: "secret-key" })).toMatchObject({
      valid: true,
      successful: true,
      reference: "LUMA-MOMO-001",
      amount: 125000,
      providerTransactionId: "987654321",
    });
    expect(verifyMomoIpn({ ...ipn, amount: 1, signature }, { accessKey: "access-key", secretKey: "secret-key" }).valid).toBe(false);
  });

  test("builds ZaloPay key1 MAC and validates callback with key2", () => {
    const payload = buildZaloPayCreatePayload({
      config: { appId: "2553", key1: "key-one" },
      appTransId: "260719_LUMA001",
      appUser: "cashier-1",
      amount: 88_000,
      appTime: 1_721_720_000_000,
      description: "Thanh toan DH001",
      callbackUrl: "https://pos.example/api/payments/zalopay/callback",
      embedData: "{}",
      item: "[]",
    });
    const raw = "2553|260719_LUMA001|cashier-1|88000|1721720000000|{}|[]";
    expect(payload.mac).toBe(createHmac("sha256", "key-one").update(raw).digest("hex"));

    const data = JSON.stringify({
      app_id: 2553,
      app_trans_id: "260719_LUMA001",
      amount: 88000,
      zp_trans_id: 240719000001,
      server_time: 1721720060000,
    });
    const mac = createHmac("sha256", "key-two").update(data).digest("hex");
    expect(verifyZaloPayCallback({ data, mac, type: 1 }, "key-two")).toMatchObject({
      valid: true,
      successful: true,
      reference: "260719_LUMA001",
      amount: 88000,
      providerTransactionId: "240719000001",
    });
    expect(verifyZaloPayCallback({ data: data.replace("88000", "1"), mac, type: 1 }, "key-two").valid).toBe(false);
  });

  test("builds and verifies VNPAY 2.1.0 HMAC-SHA512 with amount x100", () => {
    const url = buildVnpayPaymentUrl({
      config: {
        tmnCode: "LUMATEST",
        hashSecret: "vnp-secret",
        payUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
      },
      amount: 150_000,
      txnRef: "LUMA-VNPAY-001",
      orderInfo: "Thanh toan DH001",
      returnUrl: "https://pos.example/payments/return",
      ipAddress: "127.0.0.1",
      createDate: "20260719103000",
      expireDate: "20260719104500",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("vnp_Amount")).toBe("15000000");
    expect(parsed.searchParams.get("vnp_Version")).toBe("2.1.0");
    const signature = parsed.searchParams.get("vnp_SecureHash")!;
    parsed.searchParams.delete("vnp_SecureHash");
    expect(signature).toBe(createHmac("sha512", "vnp-secret").update(parsed.searchParams.toString()).digest("hex"));

    const ipn = Object.fromEntries(parsed.searchParams.entries());
    Object.assign(ipn, {
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TransactionNo: "14567890",
    });
    const sorted = new URLSearchParams(Object.entries(ipn).sort(([a], [b]) => a.localeCompare(b))).toString();
    const ipnSignature = createHmac("sha512", "vnp-secret").update(sorted).digest("hex");
    expect(verifyVnpayIpn({ ...ipn, vnp_SecureHash: ipnSignature }, "vnp-secret")).toMatchObject({
      valid: true,
      successful: true,
      reference: "LUMA-VNPAY-001",
      amount: 150000,
      providerTransactionId: "14567890",
    });
    expect(verifyVnpayIpn({ ...ipn, vnp_Amount: "100", vnp_SecureHash: ipnSignature }, "vnp-secret").valid).toBe(false);
  });

  test("gateway availability fails closed unless every credential and HTTPS callback is present", () => {
    expect(resolveGatewayAvailability({})).toEqual({ momo: false, zalopay: false, vnpay: false });
    expect(resolveGatewayAvailability({
      PAYMENT_CALLBACK_BASE_URL: "https://pos.example",
      MOMO_PARTNER_CODE: "momo",
      MOMO_ACCESS_KEY: "access",
      MOMO_SECRET_KEY: "secret",
      ZALOPAY_APP_ID: "2553",
      ZALOPAY_KEY1: "one",
      ZALOPAY_KEY2: "two",
      VNPAY_TMN_CODE: "LUMATEST",
      VNPAY_HASH_SECRET: "secret",
    })).toEqual({ momo: true, zalopay: true, vnpay: true });
    expect(resolveGatewayAvailability({
      PAYMENT_CALLBACK_BASE_URL: "http://localhost:3000",
      MOMO_PARTNER_CODE: "momo",
      MOMO_ACCESS_KEY: "access",
      MOMO_SECRET_KEY: "secret",
    }).momo).toBe(false);
  });

  test("builds official MoMo and ZaloPay inquiry signatures", () => {
    const momo = buildMomoQueryPayload({
      config: {
        partnerCode: "MOMO_TEST",
        accessKey: "access-key",
        secretKey: "secret-key",
      },
      orderId: "LUMA-MOMO-QUERY",
      requestId: "query-request-001",
    });
    const momoRaw = "accessKey=access-key&orderId=LUMA-MOMO-QUERY&partnerCode=MOMO_TEST&requestId=query-request-001";
    expect(momo.signature).toBe(createHmac("sha256", "secret-key").update(momoRaw).digest("hex"));

    const zalo = buildZaloPayQueryPayload({
      config: { appId: "2553", key1: "key-one" },
      appTransId: "260719_LUMAQUERY",
    });
    const zaloRaw = "2553|260719_LUMAQUERY|key-one";
    expect(zalo.mac).toBe(createHmac("sha256", "key-one").update(zaloRaw).digest("hex"));
  });

  test("builds VNPAY querydr request and rejects forged response", () => {
    const request = buildVnpayQueryPayload({
      config: { tmnCode: "LUMATEST", hashSecret: "vnp-secret" },
      requestId: "QUERY0001",
      txnRef: "LUMAVQUERY001",
      transactionDate: "20260719103000",
      createDate: "20260719103100",
      ipAddress: "127.0.0.1",
      orderInfo: "Query DH001",
    });
    const raw = "QUERY0001|2.1.0|querydr|LUMATEST|LUMAVQUERY001|20260719103000|20260719103100|127.0.0.1|Query DH001";
    expect(request.vnp_SecureHash).toBe(createHmac("sha512", "vnp-secret").update(raw).digest("hex"));

    const response = {
      vnp_ResponseId: "RESPONSE0001",
      vnp_Command: "querydr",
      vnp_ResponseCode: "00",
      vnp_Message: "Success",
      vnp_TmnCode: "LUMATEST",
      vnp_TxnRef: "LUMAVQUERY001",
      vnp_Amount: "15500000",
      vnp_BankCode: "NCB",
      vnp_PayDate: "20260719103500",
      vnp_TransactionNo: "14567890",
      vnp_TransactionType: "01",
      vnp_TransactionStatus: "00",
      vnp_OrderInfo: "Query DH001",
      vnp_PromotionCode: "",
      vnp_PromotionAmount: "",
    };
    const responseRaw = Object.values(response).join("|");
    const signature = createHmac("sha512", "vnp-secret").update(responseRaw).digest("hex");
    expect(verifyVnpayQueryResponse({ ...response, vnp_SecureHash: signature }, "vnp-secret")).toMatchObject({
      valid: true,
      reference: "LUMAVQUERY001",
      amount: 155000,
      providerTransactionId: "14567890",
      transactionStatus: "00",
    });
    expect(verifyVnpayQueryResponse({ ...response, vnp_Amount: "1", vnp_SecureHash: signature }, "vnp-secret").valid).toBe(false);
  });

  test("builds official provider refund signatures without trusting the client", () => {
    const momo = buildMomoRefundPayload({
      config: { partnerCode: "MOMO_TEST", accessKey: "access-key", secretKey: "secret-key" },
      refundId: "REFUND-MOMO-001",
      requestId: "refund-request-001",
      amount: 50_000,
      providerTransactionId: "987654321",
      description: "Refund return TH001",
    });
    const momoRaw = "accessKey=access-key&amount=50000&description=Refund return TH001&orderId=REFUND-MOMO-001&partnerCode=MOMO_TEST&requestId=refund-request-001&transId=987654321";
    expect(momo.signature).toBe(createHmac("sha256", "secret-key").update(momoRaw).digest("hex"));

    const zalo = buildZaloPayRefundPayload({
      config: { appId: "2553", key1: "key-one" },
      refundId: "260719_2553_REFUND001",
      providerTransactionId: "240719000001",
      amount: 50_000,
      timestamp: 1_721_720_000_000,
      description: "Refund TH001",
    });
    const zaloRaw = "2553|240719000001|50000|Refund TH001|1721720000000";
    expect(zalo.mac).toBe(createHmac("sha256", "key-one").update(zaloRaw).digest("hex"));

    const vnpay = buildVnpayRefundPayload({
      config: { tmnCode: "LUMATEST", hashSecret: "vnp-secret" },
      requestId: "REFUND0001",
      transactionType: "03",
      txnRef: "LUMAVPAY001",
      amount: 50_000,
      providerTransactionId: "14567890",
      transactionDate: "20260719103000",
      actor: "manager-1",
      createDate: "20260719110000",
      ipAddress: "127.0.0.1",
      orderInfo: "Refund TH001",
    });
    const vnpayRaw = "REFUND0001|2.1.0|refund|LUMATEST|03|LUMAVPAY001|5000000|14567890|20260719103000|manager-1|20260719110000|127.0.0.1|Refund TH001";
    expect(vnpay.vnp_SecureHash).toBe(createHmac("sha512", "vnp-secret").update(vnpayRaw).digest("hex"));
  });
});
