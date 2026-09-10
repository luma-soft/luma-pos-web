import { createHmac, timingSafeEqual } from "node:crypto";
export { buildVietQrImageUrl as buildSepayVietQrImageUrl } from "@/lib/print/payment-qr";

export type SepayWebhookInput = {
  providerEventId: string;
  referenceCode: string | null;
  accountNumber: string | null;
  subAccount: string | null;
  gateway: string | null;
  transferType: "in" | "out" | string;
  transferAmount: number;
  transactionDate: Date | null;
  content: string | null;
  rawPayload: Record<string, unknown>;
};

const REFERENCE_RE = /\bLUMA-[A-Z0-9-]+\b/i;

function firstString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^\d.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTransferType(value: string | null, amountIn: number, amountOut: number) {
  const lower = value?.toLowerCase();
  if (lower === "in" || lower === "out") return lower;
  if (lower === "deposit" || lower === "credit") return "in";
  if (lower === "withdraw" || lower === "debit") return "out";
  return amountIn > 0 || amountOut <= 0 ? "in" : "out";
}

export function normalizeSepayWebhookPayload(raw: unknown): SepayWebhookInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  const content = firstString(payload, ["content", "description", "transaction_content", "transactionContent", "transfer_content"]);
  const referenceCode = firstString(payload, ["referenceCode", "reference_code", "reference", "code", "payment_reference"])
    ?? content?.match(REFERENCE_RE)?.[0].toUpperCase()
    ?? null;
  const accountNumber = firstString(payload, ["accountNumber", "account_number", "acc", "bankAccount", "bank_account"]);
  const subAccount = firstString(payload, ["subAccount", "sub_account", "va", "virtualAccount", "virtual_account"]);
  const gateway = firstString(payload, ["gateway", "bankCode", "bank_code", "bank", "bank_name"]);
  const amountIn = firstNumber(payload, ["transferAmount", "transfer_amount", "amount", "amountIn", "amount_in"]);
  const amountOut = firstNumber(payload, ["amountOut", "amount_out"]);
  const transferAmount = amountIn > 0 ? amountIn : amountOut;
  const transferType = normalizeTransferType(firstString(payload, ["transferType", "transfer_type", "type"]), amountIn, amountOut);
  const providerEventId = firstString(payload, ["id", "transactionId", "transaction_id", "referenceId", "reference_id", "tid"])
    ?? `${accountNumber ?? "unknown"}-${referenceCode ?? content ?? "event"}-${transferAmount}`;

  return {
    providerEventId,
    referenceCode,
    accountNumber,
    subAccount,
    gateway,
    transferType,
    transferAmount,
    transactionDate: parseDate(firstString(payload, ["transactionDate", "transaction_date", "date", "created_at"])),
    content,
    rawPayload: payload,
  };
}

function safeHexEqual(leftHex: string, rightHex: string) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifySepaySignature(rawBody: string, signature: string | null, secret: string | null, timestamp?: string | null) {
  if (!secret) return true;
  if (!signature) return false;
  const cleaned = signature.replace(/^sha256=/i, "").trim();
  const candidates = [
    createHmac("sha256", secret).update(rawBody).digest("hex"),
    ...(timestamp ? [createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")] : []),
  ];
  return candidates.some((expected) => safeHexEqual(cleaned, expected));
}
