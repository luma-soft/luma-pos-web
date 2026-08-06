export type ReturnCancellationBlockReason =
  | "RETURN_ALREADY_CANCELLED"
  | "EXCHANGE_CANCEL_UNSUPPORTED"
  | "GATEWAY_CANCEL_UNSUPPORTED";

export function returnCancellationBlockReason(input: {
  status: string;
  exchangeOrderId: string | null;
  hasGatewayRefund: boolean;
}): ReturnCancellationBlockReason | null {
  if (input.status === "cancelled") return "RETURN_ALREADY_CANCELLED";
  if (input.exchangeOrderId) return "EXCHANGE_CANCEL_UNSUPPORTED";
  if (input.hasGatewayRefund) return "GATEWAY_CANCEL_UNSUPPORTED";
  return null;
}

export function returnCancellationCustomerDeltas(input: {
  refundMethod: string;
  totalRefund: number;
}) {
  return {
    totalSpent: input.totalRefund,
    currentDebt: input.refundMethod === "debt_deduct" ? input.totalRefund : 0,
  };
}
