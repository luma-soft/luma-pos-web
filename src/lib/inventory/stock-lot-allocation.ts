export type AvailableStockLot = {
  id: string;
  expiryDate: string | null;
  availableQuantity: string | number;
  receivedAt?: Date | string;
};

export type StockLotConsumption = { lotId: string; quantity: number };

/** Creates a deterministic first-expiry-first-out plan without mutating data. */
export function planLotConsumption(
  lots: AvailableStockLot[],
  requestedQuantity: number,
): StockLotConsumption[] {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error("INVALID_BATCH_QUANTITY");
  }
  const available = lots
    .filter((lot) => Number(lot.availableQuantity) > 0)
    .toSorted((a, b) => {
      if (a.expiryDate == null && b.expiryDate != null) return 1;
      if (a.expiryDate != null && b.expiryDate == null) return -1;
      const expiryOrder = (a.expiryDate ?? "").localeCompare(b.expiryDate ?? "");
      if (expiryOrder != 0) return expiryOrder;
      const receivedOrder = String(a.receivedAt ?? "").localeCompare(String(b.receivedAt ?? ""));
      return receivedOrder != 0 ? receivedOrder : a.id.localeCompare(b.id);
    });

  let remaining = requestedQuantity;
  const allocations: StockLotConsumption[] = [];
  for (const lot of available) {
    if (remaining <= 1e-9) break;
    const quantity = Math.min(Number(lot.availableQuantity), remaining);
    if (quantity > 1e-9) allocations.push({ lotId: lot.id, quantity });
    remaining -= quantity;
  }
  if (remaining > 1e-9) throw new Error("INSUFFICIENT_BATCH_STOCK");
  return allocations;
}
