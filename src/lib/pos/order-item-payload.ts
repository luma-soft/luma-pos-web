type PosOrderItemLine = {
  product: { id: string; name: string };
  unitName: string;
  unitMultiplier: number;
  quantity: number;
  unitPrice: number;
  lineDiscount?: number;
  manualPrice?: boolean;
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
  };
}
