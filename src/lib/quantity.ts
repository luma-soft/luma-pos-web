/** Preserve fractional business quantities when hydrating imported/AI drafts. */
export function positiveQuantityOrDefault(value: unknown, fallback = 1): number {
  const quantity = typeof value === "number" ? value : Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : fallback;
}
