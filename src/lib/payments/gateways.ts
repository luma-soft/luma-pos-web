import { createHmac, timingSafeEqual } from "node:crypto";

export type GatewayProvider = "momo" | "zalopay" | "vnpay";

export type VerifiedGatewayCallback = {
  valid: boolean;
  successful: boolean;
  reference: string | null;
  amount: number | null;
  providerTransactionId: string | null;
  occurredAt: Date | null;
  raw: Record<string, unknown>;
};

type Environment = Record<string, string | undefined>;

function hmac(algorithm: "sha256" | "sha512", secret: string, value: string) {
  return createHmac(algorithm, secret).update(value, "utf8").digest("hex");
}

function safeHexEqual(expected: string, received: unknown) {
  if (typeof received !== "string" || !/^[0-9a-f]+$/i.test(received)) return false;
  const left = Buffer.from(expected.toLowerCase(), "utf8");
  const right = Buffer.from(received.toLowerCase(), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function text(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function dateFromMilliseconds(value: unknown) {
  const parsed = integer(value);
  if (parsed == null || parsed <= 0) return null;
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildMomoCreatePayload(input: {
  config: { partnerCode: string; accessKey: string; secretKey: string };
  amount: number;
  orderId: string;
  requestId: string;
  orderInfo: string;
  redirectUrl: string;
  ipnUrl: string;
  extraData?: string;
  lang?: "vi" | "en";
}) {
  const amount = Math.round(input.amount);
  const extraData = input.extraData ?? "";
  const requestType = "captureWallet";
  const rawSignature = [
    `accessKey=${input.config.accessKey}`,
    `amount=${amount}`,
    `extraData=${extraData}`,
    `ipnUrl=${input.ipnUrl}`,
    `orderId=${input.orderId}`,
    `orderInfo=${input.orderInfo}`,
    `partnerCode=${input.config.partnerCode}`,
    `redirectUrl=${input.redirectUrl}`,
    `requestId=${input.requestId}`,
    `requestType=${requestType}`,
  ].join("&");
  return {
    partnerCode: input.config.partnerCode,
    requestType,
    ipnUrl: input.ipnUrl,
    redirectUrl: input.redirectUrl,
    orderId: input.orderId,
    amount,
    orderInfo: input.orderInfo,
    requestId: input.requestId,
    extraData,
    signature: hmac("sha256", input.config.secretKey, rawSignature),
    lang: input.lang ?? "vi",
  };
}

export function buildMomoQueryPayload(input: {
  config: { partnerCode: string; accessKey: string; secretKey: string };
  orderId: string;
  requestId: string;
  lang?: "vi" | "en";
}) {
  const rawSignature = [
    `accessKey=${input.config.accessKey}`,
    `orderId=${input.orderId}`,
    `partnerCode=${input.config.partnerCode}`,
    `requestId=${input.requestId}`,
  ].join("&");
  return {
    partnerCode: input.config.partnerCode,
    requestId: input.requestId,
    orderId: input.orderId,
    lang: input.lang ?? "vi",
    signature: hmac("sha256", input.config.secretKey, rawSignature),
  };
}

export function buildMomoRefundPayload(input: {
  config: { partnerCode: string; accessKey: string; secretKey: string };
  refundId: string;
  requestId: string;
  amount: number;
  providerTransactionId: string;
  description: string;
  lang?: "vi" | "en";
}) {
  const amount = Math.round(input.amount);
  const rawSignature = [
    `accessKey=${input.config.accessKey}`,
    `amount=${amount}`,
    `description=${input.description}`,
    `orderId=${input.refundId}`,
    `partnerCode=${input.config.partnerCode}`,
    `requestId=${input.requestId}`,
    `transId=${input.providerTransactionId}`,
  ].join("&");
  return {
    partnerCode: input.config.partnerCode,
    orderId: input.refundId,
    requestId: input.requestId,
    amount,
    transId: input.providerTransactionId,
    lang: input.lang ?? "vi",
    description: input.description,
    signature: hmac("sha256", input.config.secretKey, rawSignature),
  };
}

export function verifyMomoIpn(
  body: Record<string, unknown>,
  config: { accessKey: string; secretKey: string },
): VerifiedGatewayCallback {
  const rawSignature = [
    `accessKey=${config.accessKey}`,
    `amount=${text(body.amount)}`,
    `extraData=${text(body.extraData)}`,
    `message=${text(body.message)}`,
    `orderId=${text(body.orderId)}`,
    `orderInfo=${text(body.orderInfo)}`,
    `orderType=${text(body.orderType)}`,
    `partnerCode=${text(body.partnerCode)}`,
    `payType=${text(body.payType)}`,
    `requestId=${text(body.requestId)}`,
    `responseTime=${text(body.responseTime)}`,
    `resultCode=${text(body.resultCode)}`,
    `transId=${text(body.transId)}`,
  ].join("&");
  const valid = safeHexEqual(hmac("sha256", config.secretKey, rawSignature), body.signature);
  const amount = integer(body.amount);
  return {
    valid,
    successful: valid && integer(body.resultCode) === 0,
    reference: text(body.orderId) || null,
    amount,
    providerTransactionId: text(body.transId) || null,
    occurredAt: dateFromMilliseconds(body.responseTime),
    raw: body,
  };
}

export function buildZaloPayCreatePayload(input: {
  config: { appId: string; key1: string };
  appTransId: string;
  appUser: string;
  amount: number;
  appTime: number;
  description: string;
  callbackUrl: string;
  embedData?: string;
  item?: string;
  bankCode?: string;
}) {
  const amount = Math.round(input.amount);
  const embedData = input.embedData ?? "{}";
  const item = input.item ?? "[]";
  const rawSignature = [
    input.config.appId,
    input.appTransId,
    input.appUser,
    String(amount),
    String(input.appTime),
    embedData,
    item,
  ].join("|");
  return {
    app_id: input.config.appId,
    app_trans_id: input.appTransId,
    app_user: input.appUser,
    app_time: input.appTime,
    amount,
    item,
    embed_data: embedData,
    description: input.description,
    bank_code: input.bankCode ?? "zalopayapp",
    callback_url: input.callbackUrl,
    mac: hmac("sha256", input.config.key1, rawSignature),
  };
}

export function buildZaloPayQueryPayload(input: {
  config: { appId: string; key1: string };
  appTransId: string;
}) {
  const rawSignature = [
    input.config.appId,
    input.appTransId,
    input.config.key1,
  ].join("|");
  return {
    app_id: input.config.appId,
    app_trans_id: input.appTransId,
    mac: hmac("sha256", input.config.key1, rawSignature),
  };
}

export function buildZaloPayRefundPayload(input: {
  config: { appId: string; key1: string };
  refundId: string;
  providerTransactionId: string;
  amount: number;
  timestamp: number;
  description: string;
}) {
  const amount = Math.round(input.amount);
  const rawSignature = [
    input.config.appId,
    input.providerTransactionId,
    String(amount),
    input.description,
    String(input.timestamp),
  ].join("|");
  return {
    app_id: input.config.appId,
    m_refund_id: input.refundId,
    zp_trans_id: input.providerTransactionId,
    amount,
    timestamp: input.timestamp,
    description: input.description,
    mac: hmac("sha256", input.config.key1, rawSignature),
  };
}

export function buildZaloPayRefundQueryPayload(input: {
  config: { appId: string; key1: string };
  refundId: string;
  timestamp: number;
}) {
  const rawSignature = [input.config.appId, input.refundId, String(input.timestamp)].join("|");
  return {
    app_id: input.config.appId,
    m_refund_id: input.refundId,
    timestamp: input.timestamp,
    mac: hmac("sha256", input.config.key1, rawSignature),
  };
}

export function verifyZaloPayCallback(
  body: Record<string, unknown>,
  key2: string,
): VerifiedGatewayCallback {
  const data = typeof body.data === "string" ? body.data : "";
  const valid = Boolean(data) && safeHexEqual(hmac("sha256", key2, data), body.mac);
  let parsed: Record<string, unknown> = {};
  if (valid) {
    try {
      const value = JSON.parse(data);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      return {
        valid: false,
        successful: false,
        reference: null,
        amount: null,
        providerTransactionId: null,
        occurredAt: null,
        raw: body,
      };
    }
  }
  return {
    valid,
    successful: valid && integer(body.type) === 1,
    reference: text(parsed.app_trans_id) || null,
    amount: integer(parsed.amount),
    providerTransactionId: text(parsed.zp_trans_id) || null,
    occurredAt: dateFromMilliseconds(parsed.server_time),
    raw: body,
  };
}

function sortedParams(input: Record<string, string>) {
  return new URLSearchParams(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function buildVnpayPaymentUrl(input: {
  config: { tmnCode: string; hashSecret: string; payUrl: string };
  amount: number;
  txnRef: string;
  orderInfo: string;
  returnUrl: string;
  ipAddress: string;
  createDate: string;
  expireDate: string;
  locale?: "vn" | "en";
  orderType?: string;
}) {
  const params = sortedParams({
    vnp_Amount: String(Math.round(input.amount) * 100),
    vnp_Command: "pay",
    vnp_CreateDate: input.createDate,
    vnp_CurrCode: "VND",
    vnp_ExpireDate: input.expireDate,
    vnp_IpAddr: input.ipAddress,
    vnp_Locale: input.locale ?? "vn",
    vnp_OrderInfo: input.orderInfo,
    vnp_OrderType: input.orderType ?? "other",
    vnp_ReturnUrl: input.returnUrl,
    vnp_TmnCode: input.config.tmnCode,
    vnp_TxnRef: input.txnRef,
    vnp_Version: "2.1.0",
  });
  const signature = hmac("sha512", input.config.hashSecret, params.toString());
  params.append("vnp_SecureHash", signature);
  return `${input.config.payUrl}?${params.toString()}`;
}

export function buildVnpayQueryPayload(input: {
  config: { tmnCode: string; hashSecret: string };
  requestId: string;
  txnRef: string;
  transactionDate: string;
  createDate: string;
  ipAddress: string;
  orderInfo: string;
}) {
  const payload = {
    vnp_RequestId: input.requestId,
    vnp_Version: "2.1.0",
    vnp_Command: "querydr",
    vnp_TmnCode: input.config.tmnCode,
    vnp_TxnRef: input.txnRef,
    vnp_TransactionDate: input.transactionDate,
    vnp_CreateDate: input.createDate,
    vnp_IpAddr: input.ipAddress,
    vnp_OrderInfo: input.orderInfo,
  };
  return {
    ...payload,
    vnp_SecureHash: hmac(
      "sha512",
      input.config.hashSecret,
      Object.values(payload).join("|"),
    ),
  };
}

export function buildVnpayRefundPayload(input: {
  config: { tmnCode: string; hashSecret: string };
  requestId: string;
  transactionType: "02" | "03";
  txnRef: string;
  amount: number;
  providerTransactionId?: string | null;
  transactionDate: string;
  actor: string;
  createDate: string;
  ipAddress: string;
  orderInfo: string;
}) {
  const payload = {
    vnp_RequestId: input.requestId,
    vnp_Version: "2.1.0",
    vnp_Command: "refund",
    vnp_TmnCode: input.config.tmnCode,
    vnp_TransactionType: input.transactionType,
    vnp_TxnRef: input.txnRef,
    vnp_Amount: String(Math.round(input.amount) * 100),
    vnp_TransactionNo: input.providerTransactionId ?? "",
    vnp_TransactionDate: input.transactionDate,
    vnp_CreateBy: input.actor,
    vnp_CreateDate: input.createDate,
    vnp_IpAddr: input.ipAddress,
    vnp_OrderInfo: input.orderInfo,
  };
  const rawSignature = Object.values(payload).join("|");
  return {
    ...payload,
    vnp_SecureHash: hmac("sha512", input.config.hashSecret, rawSignature),
  };
}

export function verifyVnpayQueryResponse(
  body: Record<string, unknown>,
  hashSecret: string,
) {
  const fields = [
    "vnp_ResponseId",
    "vnp_Command",
    "vnp_ResponseCode",
    "vnp_Message",
    "vnp_TmnCode",
    "vnp_TxnRef",
    "vnp_Amount",
    "vnp_BankCode",
    "vnp_PayDate",
    "vnp_TransactionNo",
    "vnp_TransactionType",
    "vnp_TransactionStatus",
    "vnp_OrderInfo",
    "vnp_PromotionCode",
    "vnp_PromotionAmount",
  ] as const;
  const rawSignature = fields.map((field) => text(body[field])).join("|");
  const valid = safeHexEqual(
    hmac("sha512", hashSecret, rawSignature),
    body.vnp_SecureHash,
  );
  const providerAmount = integer(body.vnp_Amount);
  const payDate = text(body.vnp_PayDate);
  const occurredAt = /^\d{14}$/.test(payDate)
    ? new Date(`${payDate.slice(0, 4)}-${payDate.slice(4, 6)}-${payDate.slice(6, 8)}T${payDate.slice(8, 10)}:${payDate.slice(10, 12)}:${payDate.slice(12, 14)}+07:00`)
    : null;
  return {
    valid,
    responseCode: text(body.vnp_ResponseCode) || null,
    transactionStatus: text(body.vnp_TransactionStatus) || null,
    transactionType: text(body.vnp_TransactionType) || null,
    reference: text(body.vnp_TxnRef) || null,
    amount: providerAmount == null || providerAmount % 100 !== 0
      ? null
      : providerAmount / 100,
    providerTransactionId: text(body.vnp_TransactionNo) || null,
    occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime())
      ? occurredAt
      : null,
    raw: body,
  };
}

export function verifyVnpayRefundResponse(
  body: Record<string, unknown>,
  hashSecret: string,
) {
  const fields = [
    "vnp_ResponseId",
    "vnp_Command",
    "vnp_ResponseCode",
    "vnp_Message",
    "vnp_TmnCode",
    "vnp_TxnRef",
    "vnp_Amount",
    "vnp_BankCode",
    "vnp_PayDate",
    "vnp_TransactionNo",
    "vnp_TransactionType",
    "vnp_TransactionStatus",
    "vnp_OrderInfo",
  ] as const;
  const valid = safeHexEqual(
    hmac("sha512", hashSecret, fields.map((field) => text(body[field])).join("|")),
    body.vnp_SecureHash,
  );
  const providerAmount = integer(body.vnp_Amount);
  return {
    valid,
    responseCode: text(body.vnp_ResponseCode) || null,
    transactionStatus: text(body.vnp_TransactionStatus) || null,
    transactionType: text(body.vnp_TransactionType) || null,
    reference: text(body.vnp_TxnRef) || null,
    amount: providerAmount == null || providerAmount % 100 !== 0 ? null : providerAmount / 100,
    providerTransactionId: text(body.vnp_TransactionNo) || null,
    raw: body,
  };
}

export function verifyVnpayIpn(
  query: Record<string, unknown>,
  hashSecret: string,
): VerifiedGatewayCallback {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("vnp_") || key === "vnp_SecureHash" || key === "vnp_SecureHashType") continue;
    if (typeof value === "string") values[key] = value;
  }
  const valid = safeHexEqual(
    hmac("sha512", hashSecret, sortedParams(values).toString()),
    query.vnp_SecureHash,
  );
  const providerAmount = integer(query.vnp_Amount);
  const transactionDate = text(query.vnp_PayDate);
  const occurredAt = /^\d{14}$/.test(transactionDate)
    ? new Date(`${transactionDate.slice(0, 4)}-${transactionDate.slice(4, 6)}-${transactionDate.slice(6, 8)}T${transactionDate.slice(8, 10)}:${transactionDate.slice(10, 12)}:${transactionDate.slice(12, 14)}+07:00`)
    : null;
  return {
    valid,
    successful: valid && query.vnp_ResponseCode === "00" && query.vnp_TransactionStatus === "00",
    reference: text(query.vnp_TxnRef) || null,
    amount: providerAmount == null || providerAmount % 100 !== 0 ? null : providerAmount / 100,
    providerTransactionId: text(query.vnp_TransactionNo) || null,
    occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
    raw: query,
  };
}

function isHttpsBaseUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function resolveGatewayAvailability(env: Environment) {
  const callbackReady = isHttpsBaseUrl(env.PAYMENT_CALLBACK_BASE_URL);
  return {
    momo: callbackReady && Boolean(env.MOMO_PARTNER_CODE && env.MOMO_ACCESS_KEY && env.MOMO_SECRET_KEY),
    zalopay: callbackReady && Boolean(env.ZALOPAY_APP_ID && env.ZALOPAY_KEY1 && env.ZALOPAY_KEY2),
    vnpay: callbackReady && Boolean(env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET),
  };
}
