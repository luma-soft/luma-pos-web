export type PurchaseLineAmount = {
  quantity: number;
  unitCost: number;
  discInput: number;
  discMode: "vnd" | "pct";
};

export function purchaseLineDiscount(line: PurchaseLineAmount) {
  return line.discMode === "pct"
    ? Math.round((line.quantity * line.unitCost * line.discInput) / 100)
    : line.discInput;
}

export function purchaseLineTotal(line: PurchaseLineAmount) {
  return Math.max(0, line.quantity * line.unitCost - purchaseLineDiscount(line));
}

export function purchaseUnitCostFromTotal(line: PurchaseLineAmount, desiredTotal: number) {
  if (line.quantity <= 0) return 0;
  const safeTotal = Math.max(0, desiredTotal);
  const gross = line.discMode === "pct"
    ? line.discInput >= 100
      ? 0
      : safeTotal / (1 - Math.max(0, line.discInput) / 100)
    : safeTotal + Math.max(0, line.discInput);
  return Math.max(0, Math.round((gross / line.quantity) * 100) / 100);
}
