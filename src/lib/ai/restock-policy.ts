export const RESTOCK_COVER_DAYS = 14;

export type RestockPriority = "high" | "medium" | "low";

export function calculateRestock(input: {
  stock: number;
  minStock: number;
  soldQuantity: number;
  lookbackDays: number;
}) {
  const velocity = input.soldQuantity / input.lookbackDays;
  const daysOfStock = velocity > 0 ? input.stock / velocity : null;
  const suggestedQty = Math.max(
    0,
    Math.ceil(velocity * RESTOCK_COVER_DAYS) - input.stock,
  );
  const lowStock = input.minStock > 0 && input.stock <= input.minStock;
  const priority: RestockPriority =
    daysOfStock != null && daysOfStock < 7
      ? "high"
      : daysOfStock != null && daysOfStock < RESTOCK_COVER_DAYS
        ? "medium"
        : lowStock
          ? "high"
          : "low";
  return { velocity, daysOfStock, suggestedQty, priority, lowStock };
}
