export function calculateProductTax(input: {
  lines: Array<{ total: number; vatRate: number | null }>;
  discount: number;
  fallbackVatRate: number;
}) {
  const subtotal = input.lines.reduce((sum, line) => sum + line.total, 0);
  if (subtotal <= 0) return 0;
  const afterDiscount = Math.max(0, subtotal - input.discount);
  return Math.round(input.lines.reduce((tax, line) => {
    const discountedLine = line.total * (afterDiscount / subtotal);
    return tax + discountedLine * ((line.vatRate ?? input.fallbackVatRate) / 100);
  }, 0));
}
