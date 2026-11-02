import type { PricingRow } from "./pricing-table";

/** Merge refreshed data without discarding edits or reordering the current list. */
export function reconcilePricingRows(
  current: PricingRow[],
  previous: PricingRow[],
  incoming: PricingRow[],
): PricingRow[] {
  const currentById = new Map(current.map((row) => [row.id, row]));
  const previousById = new Map(previous.map((row) => [row.id, row]));
  const reconciled = incoming.map((row) => {
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
  const reconciledById = new Map(reconciled.map((row) => [row.id, row]));

  const ordered: PricingRow[] = [];
  for (const row of current) {
    const refreshed = reconciledById.get(row.id);
    if (!refreshed) continue;
    ordered.push(refreshed);
    reconciledById.delete(row.id);
  }

  // Keep newly matching rows in the server's order after the rows already shown.
  return [...ordered, ...reconciledById.values()];
}
