/** Purchase returns must never exceed the received quantity of the source receipt.
 * Quantities are compared in base units, not the display/selected unit.
 * Legacy return lines without a source item ID still count against the product.
 */
export type SourceReceiptLine = {
  id: string;
  productId: string;
  quantity: string | number;
  unitMultiplier: string | number;
};
export type SupplierReturnLine = {
  purchaseOrderItemId?: string | null;
  productId: string;
  quantity: string | number;
  unitMultiplier?: string | number | null;
};

const baseQuantity = (row: SupplierReturnLine | SourceReceiptLine) =>
  Number(row.quantity) * Number(row.unitMultiplier ?? 1);

export function sourceReturnBalances(
  source: SourceReceiptLine[],
  previous: SupplierReturnLine[],
) {
  const returnedByLine = new Map<string, number>();
  const returnedByProduct = new Map<string, number>();
  const sourceByProduct = new Map<string, number>();
  for (const line of source) {
    sourceByProduct.set(line.productId, (sourceByProduct.get(line.productId) ?? 0) + baseQuantity(line));
  }
  for (const line of previous) {
    const qty = baseQuantity(line);
    if (line.purchaseOrderItemId) {
      returnedByLine.set(line.purchaseOrderItemId, (returnedByLine.get(line.purchaseOrderItemId) ?? 0) + qty);
    }
    returnedByProduct.set(line.productId, (returnedByProduct.get(line.productId) ?? 0) + qty);
  }
  return { returnedByLine, returnedByProduct, sourceByProduct };
}

export function validateLinkedPurchaseReturn(
  source: SourceReceiptLine[],
  previous: SupplierReturnLine[],
  requested: SupplierReturnLine[],
): { ok: true; normalized: SupplierReturnLine[] } | { ok: false; error: "PRODUCT_NOT_FOUND" | "RETURN_QTY_EXCEEDS" } {
  const sourceById = new Map(source.map((line) => [line.id, line]));
  const sourcesByProduct = new Map<string, SourceReceiptLine[]>();
  for (const line of source) sourcesByProduct.set(line.productId, [...(sourcesByProduct.get(line.productId) ?? []), line]);
  const balances = sourceReturnBalances(source, previous);
  const requestedByLine = new Map<string, number>();
  const requestedByProduct = new Map<string, number>();
  const normalized: SupplierReturnLine[] = [];

  for (const line of requested) {
    const candidates = sourcesByProduct.get(line.productId) ?? [];
    const sourceLine = line.purchaseOrderItemId
      ? sourceById.get(line.purchaseOrderItemId)
      : candidates.length === 1 ? candidates[0] : undefined;
    if (!sourceLine || sourceLine.productId !== line.productId) {
      return { ok: false, error: "PRODUCT_NOT_FOUND" };
    }
    const qty = baseQuantity(line);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "RETURN_QTY_EXCEEDS" };
    requestedByLine.set(sourceLine.id, (requestedByLine.get(sourceLine.id) ?? 0) + qty);
    requestedByProduct.set(line.productId, (requestedByProduct.get(line.productId) ?? 0) + qty);
    normalized.push({ ...line, purchaseOrderItemId: sourceLine.id });
  }

  for (const [id, quantity] of requestedByLine) {
    const receipt = sourceById.get(id)!;
    if (quantity + (balances.returnedByLine.get(id) ?? 0) > baseQuantity(receipt) + 1e-8) {
      return { ok: false, error: "RETURN_QTY_EXCEEDS" };
    }
  }
  for (const [productId, quantity] of requestedByProduct) {
    if (quantity + (balances.returnedByProduct.get(productId) ?? 0) >
      (balances.sourceByProduct.get(productId) ?? 0) + 1e-8) {
      return { ok: false, error: "RETURN_QTY_EXCEEDS" };
    }
  }
  return { ok: true, normalized };
}

export function remainingLinkedPurchaseQuantities(
  source: SourceReceiptLine[],
  previous: SupplierReturnLine[],
): Record<string, number> {
  const balances = sourceReturnBalances(source, previous);
  // Unlinked historical returns are deducted conservatively; the server always
  // enforces both per-line and per-product cumulative limits.
  const legacyByProduct = new Map<string, number>();
  for (const row of previous) {
    if (!row.purchaseOrderItemId) legacyByProduct.set(
      row.productId,
      (legacyByProduct.get(row.productId) ?? 0) + baseQuantity(row),
    );
  }
  const result: Record<string, number> = {};
  for (const line of source) {
    result[line.id] = Math.max(0, baseQuantity(line)
      - (balances.returnedByLine.get(line.id) ?? 0)
      - (legacyByProduct.get(line.productId) ?? 0));
  }
  return result;
}
