export type TaxCalculationLine = {
  /** Extended line amount after line-level discount. */
  total: number;
  /** Null inherits the document fallback. Zero is an explicit 0% rate. */
  vatRate: number | null;
};

export type TaxBreakdown = {
  taxableAmount: number;
  tax: number;
  totalAfterTax: number;
  rates: number[];
};

function validMoney(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function validRate(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("Invalid VAT rate");
  return value;
}

/**
 * Calculates one authoritative VAT projection for POS preview and checkout.
 * Header discount is allocated proportionally so mixed-rate documents retain
 * the same taxable ratio at each line.
 */
export function calculateTaxBreakdown(input: {
  lines: TaxCalculationLine[];
  discount: number;
  fallbackVatRate: number;
  priceIncludesTax: boolean;
}): TaxBreakdown {
  const fallbackVatRate = validRate(input.fallbackVatRate);
  const discount = validMoney(input.discount, "tax discount");
  const normalized = input.lines.map((line) => ({
    total: validMoney(line.total, "tax line total"),
    vatRate: validRate(line.vatRate ?? fallbackVatRate),
  }));
  const subtotal = normalized.reduce((sum, line) => sum + line.total, 0);
  const rates = [...new Set(normalized.map((line) => line.vatRate))].sort((a, b) => a - b);
  if (subtotal <= 0) return { taxableAmount: 0, tax: 0, totalAfterTax: 0, rates };

  const afterDiscount = Math.max(0, subtotal - discount);
  const ratio = afterDiscount / subtotal;
  const rawTax = normalized.reduce((sum, line) => {
    const discountedLine = line.total * ratio;
    if (line.vatRate === 0) return sum;
    return sum + (input.priceIncludesTax
      ? discountedLine - discountedLine / (1 + line.vatRate / 100)
      : discountedLine * line.vatRate / 100);
  }, 0);
  const tax = Math.round(rawTax);
  const totalAfterTax = input.priceIncludesTax ? afterDiscount : afterDiscount + tax;
  return {
    taxableAmount: input.priceIncludesTax ? totalAfterTax - tax : afterDiscount,
    tax,
    totalAfterTax,
    rates,
  };
}
