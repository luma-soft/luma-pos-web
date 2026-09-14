export function sourceInvoicePriceBookId(
  items: ReadonlyArray<{ priceBookId?: string | null }>,
): string | null {
  return items[0]?.priceBookId ?? null;
}
