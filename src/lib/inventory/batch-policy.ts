export type BatchTrackedProduct = {
  id: string;
  trackBatches: boolean;
  shelfLifeDays: number | null;
};

export type ReceiptBatchLine = {
  productId: string;
  quantity: number;
  batchNumber?: string;
  expiryDate?: string;
};

export type ReceiptBatchValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validates server-owned product batch policy before a receipt mutates stock.
 * Date-only values are compared as ISO calendar dates so a lot remains valid
 * throughout its expiry day regardless of the server timezone.
 */
export function validateReceiptBatchLines(input: {
  products: BatchTrackedProduct[];
  items: ReceiptBatchLine[];
  receivedOn?: Date;
}): ReceiptBatchValidation {
  const productById = new Map(input.products.map((product) => [product.id, product]));
  const receivedDate = (input.receivedOn ?? new Date()).toISOString().slice(0, 10);

  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) return { ok: false, error: "errors.invalidData" };
    if (!product.trackBatches) continue;
    if (!item.batchNumber?.trim()) {
      return { ok: false, error: "purchases.errors.batchRequired" };
    }
    if (product.shelfLifeDays != null && !item.expiryDate) {
      return { ok: false, error: "purchases.errors.expiryRequired" };
    }
    if (item.expiryDate && item.expiryDate < receivedDate) {
      return { ok: false, error: "purchases.errors.expiredBatch" };
    }
  }

  return { ok: true };
}
