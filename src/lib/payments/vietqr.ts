import { findVietQrBank } from "@/lib/payments/vietqr-banks";

/**
 * NAPAS VietQR (EMVCo merchant-presented) payload for a bank transfer.
 * Any Vietnamese banking app can scan it; SePay webhooks still match the
 * transfer by account + description, so the same payload serves both flows.
 */
export interface VietQrInput {
  bankCode: string;
  accountNumber: string;
  amount?: number;
  reference?: string;
}

const NAPAS_GUID = "A000000727";
const SERVICE_TO_ACCOUNT = "QRIBFTTA";

function tlv(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16Ccitt(input: string) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Banking apps reject non-ASCII transfer content; keep A-Z, 0-9, space and simple separators. */
export function sanitizeVietQrReference(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .replace(/[^A-Za-z0-9 .\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

export function resolveVietQrBin(bankCode: string) {
  const trimmed = bankCode.trim();
  if (/^\d{6}$/.test(trimmed)) return trimmed;
  return findVietQrBank(trimmed)?.bin ?? null;
}

export function buildVietQrPayload(input: VietQrInput): string | null {
  const bin = resolveVietQrBin(input.bankCode);
  const accountNumber = input.accountNumber.replace(/\s+/g, "");
  if (!bin || !/^[A-Za-z0-9]{1,19}$/.test(accountNumber)) return null;
  const amount = input.amount != null && Number.isFinite(input.amount) && input.amount > 0 ? Math.round(input.amount) : null;
  const reference = sanitizeVietQrReference(input.reference);

  const beneficiary = tlv("00", bin) + tlv("01", accountNumber);
  const merchantAccount = tlv("00", NAPAS_GUID) + tlv("01", beneficiary) + tlv("02", SERVICE_TO_ACCOUNT);
  let payload = tlv("00", "01")
    + tlv("01", amount ? "12" : "11")
    + tlv("38", merchantAccount)
    + tlv("53", "704")
    + (amount ? tlv("54", String(amount)) : "")
    + tlv("58", "VN")
    + (reference ? tlv("62", tlv("08", reference)) : "");
  payload += "6304";
  return payload + crc16Ccitt(payload);
}

export const VIETQR_IMAGE_PATH = "/api/payments/vietqr";

/** URL of the Luma-rendered VietQR PNG. Pass `origin` when the consumer is not this web app (mobile clients). */
export function buildVietQrImageUrl(input: VietQrInput, origin?: string | null) {
  const params = new URLSearchParams({
    bank: input.bankCode.trim(),
    acc: input.accountNumber.replace(/\s+/g, ""),
  });
  if (input.amount != null && input.amount > 0) params.set("amount", String(Math.round(input.amount)));
  const reference = sanitizeVietQrReference(input.reference);
  if (reference) params.set("des", reference);
  const base = origin ? origin.replace(/\/+$/, "") : "";
  return `${base}${VIETQR_IMAGE_PATH}?${params.toString()}`;
}
