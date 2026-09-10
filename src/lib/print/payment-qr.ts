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

interface PrintPaymentQrAccount {
  bankCode: string;
  gateway?: string | null;
  accountNumber: string;
  accountName: string;
}

interface PrintPaymentQrLabels {
  title: string;
  bank: string;
  account: string;
  name: string;
  reference: string;
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
  account: PrintPaymentQrAccount | null | undefined;
  amount?: number;
  reference: string;
  labels: PrintPaymentQrLabels;
}): PrintPaymentQr | null {
  if (!input.enabled || !input.account) return null;
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
