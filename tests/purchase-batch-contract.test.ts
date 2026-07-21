import { describe, expect, it } from "vitest";
import { createPurchaseSchema } from "@/lib/schemas/order";

const basePurchase = {
  supplierId: "10000000-0000-4000-8000-000000000001",
  warehouseId: "20000000-0000-4000-8000-000000000001",
  items: [
    {
      productId: "30000000-0000-4000-8000-000000000001",
      quantity: 12,
      unitCost: 42_000,
      discount: 0,
      batchNumber: "LOT-2026-07",
      expiryDate: "2027-01-31",
    },
  ],
};

describe("purchase batch contract", () => {
  it("accepts a normalized batch number and ISO expiry date per receipt line", () => {
    const parsed = createPurchaseSchema.parse(basePurchase);

    expect(parsed.items[0].batchNumber).toBe("LOT-2026-07");
    expect(parsed.items[0].expiryDate).toBe("2027-01-31");
  });

  it("rejects malformed expiry dates and blank batch numbers", () => {
    expect(
      createPurchaseSchema.safeParse({
        ...basePurchase,
        items: [{ ...basePurchase.items[0], expiryDate: "31/01/2027" }],
      }).success,
    ).toBe(false);

    expect(
      createPurchaseSchema.safeParse({
        ...basePurchase,
        items: [{ ...basePurchase.items[0], batchNumber: "   " }],
      }).success,
    ).toBe(false);
  });
});
