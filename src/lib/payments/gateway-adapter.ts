import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
  buildZaloPayRefundQueryPayload,
  resolveGatewayAvailability,
  verifyVnpayQueryResponse,
  verifyVnpayRefundResponse,
  type GatewayProvider,
} from "@/lib/payments/gateways";

type Environment = Record<string, string | undefined>;

type CommonConfig = {
  callbackBaseUrl: string;
  environment: "sandbox" | "production";
};

export type MomoGatewayConfig = CommonConfig & {
  provider: "momo";
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  createUrl: string;
  queryUrl: string;
  refundUrl: string;
  refundQueryUrl: string;
};

export type ZaloPayGatewayConfig = CommonConfig & {
  provider: "zalopay";
  appId: string;
  key1: string;
  key2: string;
  createUrl: string;
  queryUrl: string;
  refundUrl: string;
  refundQueryUrl: string;
};

export type VnpayGatewayConfig = CommonConfig & {
  provider: "vnpay";
  tmnCode: string;
  hashSecret: string;
  payUrl: string;
  queryUrl: string;
  refundUrl: string;
};

export type GatewayConfig = MomoGatewayConfig | ZaloPayGatewayConfig | VnpayGatewayConfig;

export type GatewayIntentResult =
  | {
    ok: true;
    checkoutUrl: string;
    deepLink: string | null;
    qrPayload: string | null;
    providerStatus: string;
    expiresAt: Date;
  }
  | {
    ok: false;
    error: string;
    retryable: boolean;
    providerStatus?: string;
  };

export type GatewayInquiryResult =
  | {
    ok: true;
    state: "confirmed" | "pending" | "failed" | "unknown";
    reference: string;
    amount: number | null;
    providerTransactionId: string | null;
    providerStatus: string;
    occurredAt: Date | null;
    rawPayload: Record<string, unknown>;
  }
  | {
    ok: false;
    error: string;
    retryable: boolean;
    providerStatus?: string;
  };

export type GatewayRefundResult = GatewayInquiryResult;

const trim = (value: string | undefined) => value?.trim() ?? "";

export function resolveGatewayConfig(
  provider: GatewayProvider,
  env: Environment = process.env,
): GatewayConfig | null {
  const availability = resolveGatewayAvailability(env);
  if (!availability[provider]) return null;
  const callbackBaseUrl = trim(env.PAYMENT_CALLBACK_BASE_URL).replace(/\/+$/, "");
  const environment = env.PAYMENT_GATEWAY_ENV === "production" ? "production" : "sandbox";
  if (provider === "momo") {
    return {
      provider,
      callbackBaseUrl,
      environment,
      partnerCode: trim(env.MOMO_PARTNER_CODE),
      accessKey: trim(env.MOMO_ACCESS_KEY),
      secretKey: trim(env.MOMO_SECRET_KEY),
      createUrl: environment === "production"
        ? "https://payment.momo.vn/v2/gateway/api/create"
        : "https://test-payment.momo.vn/v2/gateway/api/create",
      queryUrl: environment === "production"
        ? "https://payment.momo.vn/v2/gateway/api/query"
        : "https://test-payment.momo.vn/v2/gateway/api/query",
      refundUrl: environment === "production"
        ? "https://payment.momo.vn/v2/gateway/api/refund"
        : "https://test-payment.momo.vn/v2/gateway/api/refund",
      refundQueryUrl: environment === "production"
        ? "https://payment.momo.vn/v2/gateway/api/refund/query"
        : "https://test-payment.momo.vn/v2/gateway/api/refund/query",
    };
  }
  if (provider === "zalopay") {
    return {
      provider,
      callbackBaseUrl,
      environment,
      appId: trim(env.ZALOPAY_APP_ID),
      key1: trim(env.ZALOPAY_KEY1),
      key2: trim(env.ZALOPAY_KEY2),
      createUrl: environment === "production"
        ? "https://openapi.zalopay.vn/v2/create"
        : "https://sb-openapi.zalopay.vn/v2/create",
      queryUrl: environment === "production"
        ? "https://openapi.zalopay.vn/v2/query"
        : "https://sb-openapi.zalopay.vn/v2/query",
      refundUrl: environment === "production"
        ? "https://openapi.zalopay.vn/v2/refund"
        : "https://sb-openapi.zalopay.vn/v2/refund",
      refundQueryUrl: environment === "production"
        ? "https://openapi.zalopay.vn/v2/query_refund"
        : "https://sb-openapi.zalopay.vn/v2/query_refund",
    };
  }
  return {
    provider,
    callbackBaseUrl,
    environment,
    tmnCode: trim(env.VNPAY_TMN_CODE),
    hashSecret: trim(env.VNPAY_HASH_SECRET),
    payUrl: environment === "production"
      ? "https://pay.vnpay.vn/vpcpay.html"
      : "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
    queryUrl: environment === "production"
      ? "https://pay.vnpay.vn/merchant_webapi/api/transaction"
      : "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
    refundUrl: environment === "production"
      ? "https://pay.vnpay.vn/merchant_webapi/api/transaction"
      : "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function safeSignatureEqual(expected: string, received: unknown) {
  if (typeof received !== "string" || !/^[0-9a-f]{64}$/i.test(received)) return false;
  const left = Buffer.from(expected.toLowerCase(), "utf8");
  const right = Buffer.from(received.toLowerCase(), "utf8");
  return timingSafeEqual(left, right);
}

function trustedHttpsUrl(value: unknown, domain: "momo.vn" | "zalopay.vn") {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function trustedMomoDeepLink(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "momo:" ? value : null;
  } catch {
    return null;
  }
}

function formatVnpayDate(date: Date) {
  const local = new Date(date.getTime() + 7 * 60 * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    local.getUTCFullYear(),
    pad(local.getUTCMonth() + 1),
    pad(local.getUTCDate()),
    pad(local.getUTCHours()),
    pad(local.getUTCMinutes()),
    pad(local.getUTCSeconds()),
  ].join("");
}

const MOMO_PENDING_RESULT_CODES = new Set([1000, 7000, 7002, 9000]);
const MOMO_FINAL_FAILURE_CODES = new Set([
  98, 99, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1017, 1026, 4001, 4002,
  4100,
]);

function inquiryFailure(error: unknown): GatewayInquiryResult {
  const retryable = error instanceof Error && (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    error instanceof TypeError
  );
  return {
    ok: false,
    error: retryable
      ? "payments.errors.providerUnavailable"
      : "errors.serverError",
    retryable,
  };
}

async function parseJson(response: Response) {
  try {
    const value = await response.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export async function createGatewayIntent(
  config: GatewayConfig,
  input: {
    paymentId: string;
    reference: string;
    orderCode: string;
    amount: number;
    actorId: string;
    ipAddress: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<GatewayIntentResult> {
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const orderInfo = `Thanh toan ${input.orderCode}`.slice(0, 100);
  if (config.provider === "vnpay") {
    return {
      ok: true,
      checkoutUrl: buildVnpayPaymentUrl({
        config,
        amount: input.amount,
        txnRef: input.reference,
        orderInfo,
        returnUrl: `${config.callbackBaseUrl}/api/payments/return`,
        ipAddress: input.ipAddress,
        createDate: formatVnpayDate(new Date()),
        expireDate: formatVnpayDate(expiresAt),
      }),
      deepLink: null,
      qrPayload: null,
      providerStatus: "created",
      expiresAt,
    };
  }

  try {
    if (config.provider === "momo") {
      const payload = buildMomoCreatePayload({
        config,
        amount: input.amount,
        orderId: input.reference,
        requestId: input.paymentId,
        orderInfo,
        redirectUrl: `${config.callbackBaseUrl}/api/payments/return`,
        ipnUrl: `${config.callbackBaseUrl}/api/payments/momo/ipn`,
        extraData: Buffer.from(JSON.stringify({ paymentId: input.paymentId }), "utf8").toString("base64"),
      });
      const response = await fetcher(config.createUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      const body = await parseJson(response);
      if (!response.ok || !body) {
        return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
      }
      const rawSignature = [
        `accessKey=${config.accessKey}`,
        `amount=${valueText(body.amount)}`,
        `orderId=${valueText(body.orderId)}`,
        `partnerCode=${valueText(body.partnerCode)}`,
        `payUrl=${valueText(body.payUrl)}`,
        `requestId=${valueText(body.requestId)}`,
        `responseTime=${valueText(body.responseTime)}`,
        `resultCode=${valueText(body.resultCode)}`,
      ].join("&");
      const expected = createHmac("sha256", config.secretKey).update(rawSignature).digest("hex");
      if (!safeSignatureEqual(expected, body.signature)) {
        return { ok: false, error: "payments.errors.invalidProviderSignature", retryable: false };
      }
      const providerStatus = valueText(body.resultCode);
      if (Number(body.resultCode) !== 0) {
        return {
          ok: false,
          error: "payments.errors.providerRejected",
          retryable: false,
          providerStatus,
        };
      }
      const checkoutUrl = trustedHttpsUrl(body.payUrl, "momo.vn");
      if (!checkoutUrl) {
        return { ok: false, error: "payments.errors.invalidProviderResponse", retryable: false, providerStatus };
      }
      return {
        ok: true,
        checkoutUrl,
        deepLink: trustedMomoDeepLink(body.deeplink),
        qrPayload: typeof body.qrCodeUrl === "string" ? body.qrCodeUrl : null,
        providerStatus,
        expiresAt,
      };
    }

    const payload = buildZaloPayCreatePayload({
      config,
      appTransId: input.reference,
      appUser: input.actorId.slice(0, 50),
      amount: input.amount,
      appTime: Date.now(),
      description: orderInfo,
      callbackUrl: `${config.callbackBaseUrl}/api/payments/zalopay/callback`,
      embedData: JSON.stringify({ paymentId: input.paymentId }),
    });
    const response = await fetcher(config.createUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(
        Object.entries(payload).map(([key, value]) => [key, String(value)]),
      ).toString(),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const body = await parseJson(response);
    if (!response.ok || !body) {
      return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
    }
    const providerStatus = valueText(body.return_code);
    if (Number(body.return_code) !== 1) {
      return {
        ok: false,
        error: "payments.errors.providerRejected",
        retryable: Number(body.return_code) === 3,
        providerStatus,
      };
    }
    const checkoutUrl = trustedHttpsUrl(body.order_url, "zalopay.vn");
    if (!checkoutUrl) {
      return { ok: false, error: "payments.errors.invalidProviderResponse", retryable: false, providerStatus };
    }
    return {
      ok: true,
      checkoutUrl,
      deepLink: null,
      qrPayload: typeof body.qr_code === "string" ? body.qr_code : null,
      providerStatus,
      expiresAt,
    };
  } catch (error) {
    const retryable = error instanceof Error && (
      error.name === "AbortError" || error.name === "TimeoutError" || error instanceof TypeError
    );
    console.error(`createGatewayIntent ${config.provider} failed:`, error);
    return {
      ok: false,
      error: retryable ? "payments.errors.providerUnavailable" : "errors.serverError",
      retryable,
    };
  }
}

export async function queryGatewayPayment(
  config: GatewayConfig,
  input: {
    paymentId: string;
    reference: string;
    orderCode: string;
    amount: number;
    createdAt: Date;
    ipAddress: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<GatewayInquiryResult> {
  try {
    if (config.provider === "momo") {
      const payload = buildMomoQueryPayload({
        config,
        orderId: input.reference,
        requestId: input.paymentId,
      });
      const response = await fetcher(config.queryUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      const body = await parseJson(response);
      if (!response.ok || !body) {
        return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
      }
      if (
        valueText(body.partnerCode) !== config.partnerCode ||
        valueText(body.orderId) !== input.reference
      ) {
        return { ok: false, error: "payments.errors.invalidProviderResponse", retryable: false };
      }
      const resultCode = Number(body.resultCode);
      const providerStatus = Number.isFinite(resultCode) ? String(resultCode) : "unknown";
      const state = resultCode === 0
        ? "confirmed"
        : MOMO_PENDING_RESULT_CODES.has(resultCode)
          ? "pending"
          : MOMO_FINAL_FAILURE_CODES.has(resultCode)
            ? "failed"
            : "unknown";
      return {
        ok: true,
        state,
        reference: input.reference,
        amount: Number.isSafeInteger(Number(body.amount)) ? Number(body.amount) : null,
        providerTransactionId: valueText(body.transId) || null,
        providerStatus,
        occurredAt: Number.isSafeInteger(Number(body.responseTime))
          ? new Date(Number(body.responseTime))
          : null,
        rawPayload: body,
      };
    }

    if (config.provider === "zalopay") {
      const payload = buildZaloPayQueryPayload({
        config,
        appTransId: input.reference,
      });
      const response = await fetcher(config.queryUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams(payload).toString(),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      const body = await parseJson(response);
      if (!response.ok || !body) {
        return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
      }
      const returnCode = Number(body.return_code);
      const providerStatus = Number.isFinite(returnCode) ? String(returnCode) : "unknown";
      const state = returnCode === 1
        ? "confirmed"
        : returnCode === 3
          ? "pending"
          : returnCode === 2
            ? "failed"
            : "unknown";
      return {
        ok: true,
        state,
        reference: input.reference,
        amount: Number.isSafeInteger(Number(body.amount)) ? Number(body.amount) : null,
        providerTransactionId: valueText(body.zp_trans_id) || null,
        providerStatus,
        occurredAt: Number.isSafeInteger(Number(body.server_time))
          ? new Date(Number(body.server_time))
          : null,
        rawPayload: body,
      };
    }

    const requestId = createHash("sha256")
      .update(`${input.paymentId}:${Date.now()}`)
      .digest("hex")
      .slice(0, 32)
      .toUpperCase();
    const orderInfo = `Query ${input.orderCode}`.slice(0, 255);
    const payload = buildVnpayQueryPayload({
      config,
      requestId,
      txnRef: input.reference,
      transactionDate: formatVnpayDate(input.createdAt),
      createDate: formatVnpayDate(new Date()),
      ipAddress: input.ipAddress,
      orderInfo,
    });
    const response = await fetcher(config.queryUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const body = await parseJson(response);
    if (!response.ok || !body) {
      return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
    }
    const verified = verifyVnpayQueryResponse(body, config.hashSecret);
    if (
      !verified.valid ||
      valueText(body.vnp_TmnCode) !== config.tmnCode ||
      verified.reference !== input.reference
    ) {
      return { ok: false, error: "payments.errors.invalidProviderSignature", retryable: false };
    }
    const providerStatus = `${verified.responseCode ?? ""}:${verified.transactionStatus ?? ""}`;
    const state = verified.responseCode !== "00"
      ? "unknown"
      : verified.transactionStatus === "00"
        ? "confirmed"
        : verified.transactionStatus === "01"
          ? "pending"
          : verified.transactionStatus
            ? "failed"
            : "unknown";
    return {
      ok: true,
      state,
      reference: input.reference,
      amount: verified.amount,
      providerTransactionId: verified.providerTransactionId,
      providerStatus,
      occurredAt: verified.occurredAt,
      rawPayload: body,
    };
  } catch (error) {
    console.error(`queryGatewayPayment ${config.provider} failed:`, error);
    return inquiryFailure(error);
  }
}

export type GatewayRefundRequest = {
  refundId: string;
  reference: string;
  sourceReference: string;
  sourceProviderTransactionId: string;
  amount: number;
  originalAmount: number;
  paymentCreatedAt: Date;
  actorId: string;
  ipAddress: string;
  description: string;
};

function refundStateFromCode(code: number) {
  if (code === 0) return "confirmed" as const;
  if (MOMO_PENDING_RESULT_CODES.has(code)) return "pending" as const;
  if (MOMO_FINAL_FAILURE_CODES.has(code)) return "failed" as const;
  return "unknown" as const;
}

export async function createGatewayRefund(
  config: GatewayConfig,
  input: GatewayRefundRequest,
  fetcher: typeof fetch = fetch,
): Promise<GatewayRefundResult> {
  try {
    if (config.provider === "momo") {
      const payload = buildMomoRefundPayload({
        config,
        refundId: input.reference,
        requestId: input.refundId,
        amount: input.amount,
        providerTransactionId: input.sourceProviderTransactionId,
        description: input.description.slice(0, 100),
      });
      const response = await fetcher(config.refundUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      const body = await parseJson(response);
      if (!response.ok || !body) return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
      if (
        valueText(body.partnerCode) !== config.partnerCode ||
        valueText(body.orderId) !== input.reference ||
        valueText(body.requestId) !== input.refundId
      ) return { ok: false, error: "payments.errors.invalidProviderResponse", retryable: false };
      const code = Number(body.resultCode);
      return {
        ok: true,
        state: refundStateFromCode(code),
        reference: input.reference,
        amount: Number.isSafeInteger(Number(body.amount)) ? Number(body.amount) : null,
        providerTransactionId: valueText(body.transId) || null,
        providerStatus: Number.isFinite(code) ? String(code) : "unknown",
        occurredAt: Number.isSafeInteger(Number(body.responseTime)) ? new Date(Number(body.responseTime)) : null,
        rawPayload: body,
      };
    }

    if (config.provider === "zalopay") {
      const payload = buildZaloPayRefundPayload({
        config,
        refundId: input.reference,
        providerTransactionId: input.sourceProviderTransactionId,
        amount: input.amount,
        timestamp: Date.now(),
        description: input.description.slice(0, 100),
      });
      const response = await fetcher(config.refundUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])).toString(),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      const body = await parseJson(response);
      if (!response.ok || !body) return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
      const code = Number(body.return_code);
      return {
        ok: true,
        // ZaloPay documents refund creation as asynchronous; even an accepted
        // request must be queried before money is considered refunded.
        state: code === 2 ? "failed" : code === 1 || code === 3 ? "pending" : "unknown",
        reference: input.reference,
        amount: input.amount,
        providerTransactionId: valueText(body.refund_id) || null,
        providerStatus: Number.isFinite(code) ? String(code) : "unknown",
        occurredAt: null,
        rawPayload: body,
      };
    }

    const requestId = createHash("sha256").update(input.refundId).digest("hex").slice(0, 32).toUpperCase();
    const payload = buildVnpayRefundPayload({
      config,
      requestId,
      transactionType: input.amount >= input.originalAmount ? "02" : "03",
      txnRef: input.sourceReference,
      amount: input.amount,
      providerTransactionId: input.sourceProviderTransactionId,
      transactionDate: formatVnpayDate(input.paymentCreatedAt),
      actor: input.actorId.slice(0, 245),
      createDate: formatVnpayDate(new Date()),
      ipAddress: input.ipAddress,
      orderInfo: input.description.slice(0, 255),
    });
    const response = await fetcher(config.refundUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const body = await parseJson(response);
    if (!response.ok || !body) return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
    const verified = verifyVnpayRefundResponse(body, config.hashSecret);
    if (!verified.valid || valueText(body.vnp_TmnCode) !== config.tmnCode || verified.reference !== input.sourceReference) {
      return { ok: false, error: "payments.errors.invalidProviderSignature", retryable: false };
    }
    const status = verified.transactionStatus;
    const responseCode = verified.responseCode;
    const state = responseCode === "00" && status === "00"
      ? "confirmed"
      : responseCode === "94" || status === "05" || status === "06"
        ? "pending"
        : responseCode === "00" && !status
          ? "unknown"
          : "failed";
    return {
      ok: true,
      state,
      reference: input.reference,
      amount: verified.amount,
      providerTransactionId: verified.providerTransactionId,
      providerStatus: `${responseCode ?? ""}:${status ?? ""}`,
      occurredAt: null,
      rawPayload: body,
    };
  } catch (error) {
    console.error(`createGatewayRefund ${config.provider} failed:`, error);
    return inquiryFailure(error);
  }
}

export async function queryGatewayRefund(
  config: GatewayConfig,
  input: GatewayRefundRequest,
  fetcher: typeof fetch = fetch,
): Promise<GatewayRefundResult> {
  try {
    if (config.provider === "momo") {
      const payload = buildMomoQueryPayload({ config, orderId: input.reference, requestId: input.refundId });
      const response = await fetcher(config.refundQueryUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000), cache: "no-store",
      });
      const body = await parseJson(response);
      if (!response.ok || !body) return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
      if (valueText(body.partnerCode) !== config.partnerCode) return { ok: false, error: "payments.errors.invalidProviderResponse", retryable: false };
      const rows = Array.isArray(body.refundTrans) ? body.refundTrans.filter(isRecord) : [];
      const row = rows.find((item) => valueText(item.orderId) === input.reference);
      if (!row) {
        return {
          ok: true, state: "unknown", reference: input.reference, amount: null,
          providerTransactionId: null, providerStatus: valueText(body.resultCode) || "unknown",
          occurredAt: null, rawPayload: body,
        };
      }
      const code = Number(row.resultCode);
      return {
        ok: true, state: refundStateFromCode(code), reference: input.reference,
        amount: Number.isSafeInteger(Number(row.amount)) ? Number(row.amount) : null,
        providerTransactionId: valueText(row.transId) || null,
        providerStatus: Number.isFinite(code) ? String(code) : "unknown",
        occurredAt: Number.isSafeInteger(Number(row.createdTime)) ? new Date(Number(row.createdTime)) : null,
        rawPayload: body,
      };
    }

    if (config.provider === "zalopay") {
      const payload = buildZaloPayRefundQueryPayload({ config, refundId: input.reference, timestamp: Date.now() });
      const response = await fetcher(config.refundQueryUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])).toString(),
        signal: AbortSignal.timeout(30_000), cache: "no-store",
      });
      const body = await parseJson(response);
      if (!response.ok || !body) return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
      const refundStatus = Number(body.refund_status);
      const state = refundStatus === 1 ? "confirmed" : refundStatus === 2 ? "failed" : refundStatus === 3 ? "pending" : "unknown";
      return {
        ok: true, state, reference: input.reference, amount: input.amount,
        providerTransactionId: valueText(body.refund_id) || null,
        providerStatus: Number.isFinite(refundStatus) ? String(refundStatus) : valueText(body.return_code) || "unknown",
        occurredAt: null, rawPayload: body,
      };
    }

    const requestId = createHash("sha256").update(`${input.refundId}:query:${Date.now()}`).digest("hex").slice(0, 32).toUpperCase();
    const payload = buildVnpayQueryPayload({
      config, requestId, txnRef: input.sourceReference,
      transactionDate: formatVnpayDate(input.paymentCreatedAt), createDate: formatVnpayDate(new Date()),
      ipAddress: input.ipAddress, orderInfo: `Query refund ${input.reference}`.slice(0, 255),
    });
    const response = await fetcher(config.queryUrl, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000), cache: "no-store",
    });
    const body = await parseJson(response);
    if (!response.ok || !body) return { ok: false, error: "payments.errors.providerUnavailable", retryable: true };
    const verified = verifyVnpayQueryResponse(body, config.hashSecret);
    if (!verified.valid || verified.reference !== input.sourceReference || valueText(body.vnp_TmnCode) !== config.tmnCode) {
      return { ok: false, error: "payments.errors.invalidProviderSignature", retryable: false };
    }
    const refundType = verified.transactionType === "02" || verified.transactionType === "03";
    const state = !refundType
      ? "unknown"
      : verified.transactionStatus === "00"
        ? "confirmed"
        : verified.transactionStatus === "05" || verified.transactionStatus === "06"
          ? "pending"
          : "failed";
    return {
      ok: true, state, reference: input.reference, amount: verified.amount,
      providerTransactionId: verified.providerTransactionId,
      providerStatus: `${verified.responseCode ?? ""}:${verified.transactionStatus ?? ""}`,
      occurredAt: verified.occurredAt, rawPayload: body,
    };
  } catch (error) {
    console.error(`queryGatewayRefund ${config.provider} failed:`, error);
    return inquiryFailure(error);
  }
}
