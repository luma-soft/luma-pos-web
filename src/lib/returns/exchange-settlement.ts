export type ExchangeSettlementMethod = "cash" | "bank_transfer" | "card" | "credit";
export type ExchangeRefundMethod = "cash" | "bank_transfer" | "debt_deduct" | "momo" | "zalopay" | "vnpay";

export type ExchangeSettlement = {
  returnTotal: number;
  replacementTotal: number;
  difference: number;
  direction: "collect" | "refund" | "even";
  exchangeCredit: number;
  amountPaid: number;
  paymentStatus: "unpaid" | "partial" | "paid";
  debtDelta: number;
  cashIn: number;
  cashOut: number;
};

const money = (value: number) => Math.round(value * 100) / 100;

export function calculateExchangeSettlement(input: {
  returnTotal: number;
  replacementTotal: number;
  settlementMethod: ExchangeSettlementMethod;
  refundMethod: ExchangeRefundMethod;
}): ExchangeSettlement {
  if (![input.returnTotal, input.replacementTotal].every(Number.isFinite)
      || input.returnTotal < 0
      || input.replacementTotal < 0) {
    throw new Error("INVALID_EXCHANGE_TOTAL");
  }

  const returnTotal = money(input.returnTotal);
  const replacementTotal = money(input.replacementTotal);
  const difference = money(replacementTotal - returnTotal);
  const exchangeCredit = money(Math.min(returnTotal, replacementTotal));
  const amountPaid = difference > 0 && input.settlementMethod === "credit"
    ? exchangeCredit
    : replacementTotal;
  const paymentStatus = amountPaid >= replacementTotal
    ? "paid"
    : amountPaid > 0
      ? "partial"
      : "unpaid";

  return {
    returnTotal,
    replacementTotal,
    difference,
    direction: difference > 0 ? "collect" : difference < 0 ? "refund" : "even",
    exchangeCredit,
    amountPaid,
    paymentStatus,
    debtDelta: difference > 0 && input.settlementMethod === "credit"
      ? difference
      : difference < 0 && input.refundMethod === "debt_deduct"
        ? difference
        : 0,
    cashIn: difference > 0 && input.settlementMethod !== "credit" ? difference : 0,
    cashOut: difference < 0 && ["cash", "bank_transfer"].includes(input.refundMethod) ? -difference : 0,
  };
}
