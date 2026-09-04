type CheckoutPriceLine = {
  product: { id: string };
  unitName: string;
  unitMultiplier: number;
};

/** Snapshot what the cashier saw, not a second calculation from a newer catalog. */
export function buildExpectedPosPricing<T extends CheckoutPriceLine>(
  cart: readonly T[],
  finalUnitPrice: (line: T) => number,
) {
  return {
    version: 1 as const,
    lines: cart.map((line) => ({
      productId: line.product.id,
      unitName: line.unitName,
      unitMultiplier: line.unitMultiplier,
      unitPrice: finalUnitPrice(line),
    })),
  };
}

type OrderResult<T> = { ok: true; data: T } | { ok: false; error: string };
type PosOrderRequestResult<T> =
  | { kind: "created"; data: T }
  | { kind: "rejected"; error: string }
  | { kind: "connection-failed" };

/** Business rejections must never enter the offline-success path or be retried. */
export async function requestPosOrder<TInput, TData>(
  payload: TInput,
  create: (input: TInput) => Promise<OrderResult<TData>>,
): Promise<PosOrderRequestResult<TData>> {
  try {
    const result = await create(payload);
    return result.ok
      ? { kind: "created", data: result.data }
      : { kind: "rejected", error: result.error };
  } catch {
    return { kind: "connection-failed" };
  }
}

export function countPosPricingConflicts(
  outbox: readonly { failed?: boolean; failReason?: string }[],
) {
  return outbox.filter((item) => item.failed && item.failReason === "pos.errors.pricingChanged").length;
}
