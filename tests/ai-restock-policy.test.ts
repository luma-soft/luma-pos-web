import { describe, expect, it } from "vitest";
import { calculateRestock, RESTOCK_COVER_DAYS } from "@/lib/ai/restock-policy";

describe("AI restocking policy", () => {
  it("uses the stated lookback and cover assumptions", () => {
    const result = calculateRestock({
      stock: 3,
      minStock: 5,
      soldQuantity: 30,
      lookbackDays: 30,
    });

    expect(RESTOCK_COVER_DAYS).toBe(14);
    expect(result.velocity).toBe(1);
    expect(result.suggestedQty).toBe(11);
    expect(result.priority).toBe("high");
  });

  it("does not invent demand when there are no sales", () => {
    const result = calculateRestock({
      stock: 2,
      minStock: 5,
      soldQuantity: 0,
      lookbackDays: 30,
    });

    expect(result.velocity).toBe(0);
    expect(result.suggestedQty).toBe(0);
    expect(result.lowStock).toBe(true);
  });
});
