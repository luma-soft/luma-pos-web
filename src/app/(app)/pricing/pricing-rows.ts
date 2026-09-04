import type { PricingRow } from "./pricing-table";

/** Merge a refreshed server snapshot without discarding unacknowledged edits. */
export function reconcilePricingRows(
  current: PricingRow[],
  previous: PricingRow[],
  incoming: PricingRow[],
): PricingRow[] {
  const currentById = new Map(current.map((row) => [row.id, row]));
  const previousById = new Map(previous.map((row) => [row.id, row]));
  return incoming.map((row) => {
    const local = currentById.get(row.id);
    const before = previousById.get(row.id);
    if (!local || !before) return row;
    const prices = { ...row.prices };
    for (const bookId of Object.keys(prices)) {
      if (local.prices[bookId] !== before.prices[bookId]) {
        prices[bookId] = local.prices[bookId];
      }
    }
    return { ...row, prices };
  });
}
