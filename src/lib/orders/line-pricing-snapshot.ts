type SavedOrderLine = {
  quantity: number | string;
  unitPrice: number | string;
  total: number | string;
  discount?: number | string | null;
  preDiscountUnitPrice?: number | string | null;
  lineDiscountMode?: string | null;
  lineDiscountValue?: number | string | null;
};

/** New rows store net unitPrice. Legacy imports may store gross unitPrice and
 * either per-unit or total discount, so their saved total is the authority. */
export function readOrderLinePricing(item: SavedOrderLine) {
  const quantity = Math.max(0, Number(item.quantity));
  const total = Math.max(0, Number(item.total));
  const netUnitPrice = quantity > 0 ? total / quantity : Number(item.unitPrice);
  const unitPrice = Math.max(netUnitPrice, Number(item.preDiscountUnitPrice ?? item.unitPrice));
  const discount = Math.max(0, unitPrice * quantity - total);
  const lineDiscount = quantity > 0 ? discount / quantity : 0;
  const lineDiscountMode: "pct" | "vnd" = item.preDiscountUnitPrice != null && item.lineDiscountMode === "pct" ? "pct" : "vnd";
  const lineDiscountValue = item.preDiscountUnitPrice != null && item.lineDiscountValue != null
    ? Number(item.lineDiscountValue)
    : lineDiscount;
  return { unitPrice, netUnitPrice, lineDiscount, discount, lineDiscountMode, lineDiscountValue };
}
