export function deriveEInvoiceFallbackVatRate(input: {
  subtotal: number;
  discount: number;
  tax: number;
}): number {
  const taxableBase = Math.max(0, input.subtotal - input.discount);
  if (!Number.isFinite(taxableBase) || taxableBase <= 0) return 0;
  const inferred = (input.tax / taxableBase) * 100;
  if (!Number.isFinite(inferred)) return 0;
  return Math.min(20, Math.max(0, inferred));
}
