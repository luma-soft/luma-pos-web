import { calculateTaxBreakdown } from "@/lib/tax/calculations";

export function calculateProductTax(input: {
  lines: Array<{ total: number; vatRate: number | null }>;
  discount: number;
  fallbackVatRate: number;
  priceIncludesTax?: boolean;
}) {
  return calculateTaxBreakdown({
    ...input,
    priceIncludesTax: input.priceIncludesTax ?? false,
  }).tax;
}
