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

export function returnCancellationStockTargets(
  movements: Array<{ productId: string; warehouseId: string; quantity: string | number }>,
) {
  const totals = new Map<string, { productId: string; warehouseId: string; quantity: number }>();
  for (const movement of movements) {
    const quantity = Number(movement.quantity);
    if (quantity <= 0) continue;
    const key = `${movement.productId}:${movement.warehouseId}`;
    const current = totals.get(key);
    totals.set(key, {
      productId: movement.productId,
      warehouseId: movement.warehouseId,
      quantity: (current?.quantity ?? 0) + quantity,
    });
  }
  return [...totals.values()];
}
