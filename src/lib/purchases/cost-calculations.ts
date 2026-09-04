export type PurchaseCostInput = {
  items: readonly { quantity: number; unitCost: number; discount: number }[];
  discount: number;
  vatRate: number;
  shippingFee?: number;
};

export type PurchaseLineCost = {
  quantity: number;
  grossUnitCost: number;
  /** Line value after its own discount, before invoice-level allocation. */
  netTotal: number;
  invoiceDiscount: number;
  tax: number;
  shippingFee: number;
  landedTotal: number;
  /** Keep the quotient unrounded until the resulting average is persisted. */
  landedUnitCost: number;
};

function nonnegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid ${field}`);
  return value;
}

function safeCents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Currency amount exceeds safe precision");
  return value;
}

function cents(value: number, field: string) {
  nonnegative(value, field);
  // Correct binary representation around a decimal half-cent before rounding.
  return safeCents(Math.round((value + Math.max(1, value) * Number.EPSILON) * 100));
}

/** Integer weights preserve proportional allocation even for fractional quantities. */
function quantityWeights(quantities: readonly number[]): bigint[] {
  const parts = quantities.map((quantity) => {
    const [mantissa, exponent = "0"] = String(quantity).split("e");
    const [whole, fraction = ""] = mantissa.split(".");
    return { digits: BigInt(whole + fraction), exponent: Number(exponent) - fraction.length };
  });
  const minimumExponent = Math.min(...parts.map((part) => part.exponent));
  return parts.map((part) => part.digits * BigInt(10) ** BigInt(part.exponent - minimumExponent));
}

/** Largest remainder, with input order breaking ties, so all allocated cents reconcile. */
function allocate(total: number, weights: readonly bigint[]): number[] {
  const denominator = weights.reduce((sum, weight) => sum + weight, BigInt(0));
  if (denominator <= BigInt(0)) throw new RangeError("Allocation requires positive weights");
  const amount = BigInt(safeCents(total));
  const shares = weights.map((weight, index) => {
    const numerator = amount * weight;
    return { index, cents: Number(numerator / denominator), remainder: numerator % denominator };
  });
  const remainder = total - shares.reduce((sum, share) => sum + share.cents, 0);
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder
    ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remainder; index++) ranked[index].cents++;
  return shares.map((share) => share.cents);
}

/** All monetary totals are in VND, with exact cent allocation across receipt lines. */
export function calculatePurchaseCosts(input: PurchaseCostInput) {
  if (input.items.length === 0) throw new RangeError("A receipt needs at least one item");
  nonnegative(input.vatRate, "VAT rate");
  const lines = input.items.map((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new RangeError("Invalid quantity");
    const grossUnitCost = cents(item.unitCost, "unit cost") / 100;
    const gross = cents(item.quantity * grossUnitCost, "line gross total");
    const discount = cents(item.discount, "line discount");
    return { quantity: item.quantity, grossUnitCost, net: Math.max(0, gross - discount) };
  });
  const subtotal = safeCents(lines.reduce((sum, line) => sum + line.net, 0));
  const discount = Math.min(subtotal, cents(input.discount, "invoice discount"));
  const afterDiscount = subtotal - discount;
  const tax = safeCents(Math.round((afterDiscount / 100) * input.vatRate / 100) * 100);
  const shippingFee = cents(input.shippingFee ?? 0, "shipping fee");
  const weights = subtotal > 0
    ? lines.map((line) => BigInt(line.net))
    : quantityWeights(lines.map((line) => line.quantity));
  const discounts = allocate(discount, weights);
  const taxes = allocate(tax, weights);
  const shippingFees = allocate(shippingFee, weights);
  const total = safeCents(afterDiscount + tax + shippingFee);
  const allocatedLines: PurchaseLineCost[] = lines.map((line, index) => {
    const landedTotal = safeCents(line.net - discounts[index] + taxes[index] + shippingFees[index]) / 100;
    return {
      quantity: line.quantity,
      grossUnitCost: line.grossUnitCost,
      netTotal: line.net / 100,
      invoiceDiscount: discounts[index] / 100,
      tax: taxes[index] / 100,
      shippingFee: shippingFees[index] / 100,
      landedTotal,
      landedUnitCost: nonnegative(landedTotal / line.quantity, "landed unit cost"),
    };
  });
  return {
    subtotal: subtotal / 100, afterDiscount: afterDiscount / 100,
    discount: discount / 100, tax: tax / 100, shippingFee: shippingFee / 100,
    total: total / 100, lines: allocatedLines,
  };
}

export type MovingAverageState = { quantity: number; unitCost: number };
export type MovingAverageEvent = {
  kind: "receipt" | "movement";
  quantity: number;
  unitCost?: number | null;
};

/**
 * Replay already reconciled events in their effective chronological order.
 * Quantity-only movements preserve the average; valued receipts change it.
 * This does not infer an opening value or reconstruct missing transaction history.
 */
export function replayMovingAverage(initial: MovingAverageState, events: readonly MovingAverageEvent[]): MovingAverageState {
  if (!Number.isFinite(initial.quantity)) throw new RangeError("Invalid opening quantity");
  let quantity = initial.quantity;
  let unitCost = nonnegative(initial.unitCost, "opening unit cost");
  for (const event of events) {
    if (!Number.isFinite(event.quantity)) throw new RangeError("Invalid movement quantity");
    if (event.kind === "receipt") {
      if (event.quantity <= 0 || event.unitCost == null) throw new RangeError("A receipt needs positive quantity and a known cost");
      const incomingCost = nonnegative(event.unitCost, "receipt unit cost");
      const existingQuantity = Math.max(quantity, 0);
      const denominator = existingQuantity + event.quantity;
      // Ratios avoid overflowing an intermediate quantity * price product.
      unitCost = existingQuantity === 0 ? incomingCost
        : unitCost * (existingQuantity / denominator) + incomingCost * (event.quantity / denominator);
      nonnegative(unitCost, "average unit cost");
    }
    quantity += event.quantity;
    if (!Number.isFinite(quantity)) throw new RangeError("Movement quantity exceeds safe precision");
  }
  return { quantity, unitCost };
}
