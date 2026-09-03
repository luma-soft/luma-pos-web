import { z } from "zod";

// stock_levels.quantity uses numeric(14, 4), including negative balances.
export const stockQuantitySchema = z.number()
  .min(-9_999_999_999.9999)
  .max(9_999_999_999.9999)
  .multipleOf(0.0001);

export const productStockAdjustmentSchema = z.object({
  quantity: stockQuantitySchema,
  expectedQuantity: stockQuantitySchema,
});

export type ProductStockAdjustment = z.infer<typeof productStockAdjustmentSchema>;

export function changedProductStock(
  quantity: number | undefined,
  expectedQuantity: number | undefined,
): ProductStockAdjustment | undefined {
  if (quantity === undefined || expectedQuantity === undefined || quantity === expectedQuantity) {
    return undefined;
  }
  return { quantity, expectedQuantity };
}
