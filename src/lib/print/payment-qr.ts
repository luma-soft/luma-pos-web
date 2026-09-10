export interface PrintPaymentQr {
  title: string;
  qrImageUrl: string;
  bankLabel: string;
  accountLabel: string;
  nameLabel: string;
  referenceLabel: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  reference: string;
}

export interface PrintPaymentQrAccount {
  bankCode: string;
  gateway?: string | null;
  accountNumber: string;
  accountName: string;
}

interface PrintPaymentQrAccountOptions {
  paymentQrAccountSource?: "default" | "custom";
  paymentQrCustomBankCode?: string;
  paymentQrCustomBankName?: string;
  paymentQrCustomAccountNumber?: string;
  paymentQrCustomAccountName?: string;
}

interface PrintPaymentQrLabels {
  title: string;
  bank: string;
  account: string;
  name: string;
  reference: string;
}

export function formatPrintPaymentReference(template: string | null | undefined, invoiceCode: string): string {
  const value = template?.trim() || "{invoiceCode}";
  return value.replaceAll("{invoiceCode}", invoiceCode).replace(/\s+/g, " ").trim().slice(0, 100);
}

export function resolvePrintPaymentQrAccount(
  options: PrintPaymentQrAccountOptions,
  defaultAccount: PrintPaymentQrAccount | null | undefined,
): PrintPaymentQrAccount | null {
  if (options.paymentQrAccountSource !== "custom") return defaultAccount ?? null;
  const bankCode = options.paymentQrCustomBankCode?.trim();
  const accountNumber = options.paymentQrCustomAccountNumber?.replace(/\s+/g, "");
  if (!bankCode || !accountNumber) return null;
  return {
    bankCode,
    gateway: options.paymentQrCustomBankName?.trim() || bankCode,
    accountNumber,
    accountName: options.paymentQrCustomAccountName?.trim() || "",
  };
}

export function buildVietQrImageUrl(input: {
  bankCode: string;
  accountNumber: string;
  amount?: number;
  reference: string;
}) {
  const params = new URLSearchParams({
    acc: input.accountNumber,
    bank: input.bankCode,
    des: input.reference,
  });
  if (input.amount != null && input.amount > 0) {
    params.set("amount", String(Math.round(input.amount)));
  }
  return `https://qr.sepay.vn/img?${params.toString()}`;
}

export function buildPrintPaymentQr(input: {
  enabled: boolean;
  alwaysShow?: boolean;
  account: PrintPaymentQrAccount | null | undefined;
  amount?: number;
  reference: string;
  labels: PrintPaymentQrLabels;
}): PrintPaymentQr | null {
  if (!input.enabled || !input.account || (!(input.amount != null && input.amount > 0) && !input.alwaysShow)) return null;
  return {
    title: input.labels.title,
    qrImageUrl: buildVietQrImageUrl({
      bankCode: input.account.bankCode,
      accountNumber: input.account.accountNumber,
      amount: input.amount,
      reference: input.reference,
    }),
    bankLabel: input.labels.bank,
    accountLabel: input.labels.account,
    nameLabel: input.labels.name,
    referenceLabel: input.labels.reference,
    bankName: input.account.gateway ?? input.account.bankCode,
    accountNumber: input.account.accountNumber,
    accountName: input.account.accountName,
    reference: input.reference,
  };
}
