type PosOrderItemLine = {
  product: { id: string; name: string };
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  unitPrice: number;
  lineDiscount?: number;
  lineDiscountMode?: "vnd" | "pct";
  lineDiscountValue?: number;
  manualPrice?: boolean;
  /** undefined = inherit invoice price book; empty string = explicitly use default book. */
  priceBook?: string;
};

export function buildPosOrderItemPayload(line: PosOrderItemLine) {
  return {
    productId: line.product.id,
    productName: line.product.name,
    unitName: line.unitName,
    unitMultiplier: line.unitMultiplier,
    quantity: line.quantity,
    manualUnitPrice: line.manualPrice ? line.unitPrice : undefined,
    lineDiscount: line.lineDiscount ?? 0,
    lineDiscountMode: line.lineDiscountMode,
    lineDiscountValue: line.lineDiscountValue,
    priceBookId: line.priceBook === undefined ? undefined : line.priceBook || null,
  };
}
