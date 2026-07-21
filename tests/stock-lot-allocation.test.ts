import { describe, expect, it } from "vitest";
import { planLotConsumption } from "@/lib/inventory/stock-lot-allocation";

describe("stock lot allocation", () => {
  it("allocates FEFO and leaves non-expiring stock last", () => {
    const plan = planLotConsumption(
      [
        { id: "no-expiry", expiryDate: null, availableQuantity: 10 },
        { id: "later", expiryDate: "2027-03-01", availableQuantity: 4 },
        { id: "soon", expiryDate: "2026-08-01", availableQuantity: 3 },
      ],
      5,
    );

    expect(plan).toEqual([
      { lotId: "soon", quantity: 3 },
      { lotId: "later", quantity: 2 },
    ]);
  });

  it("fails atomically when tracked lot stock is insufficient", () => {
    expect(() =>
      planLotConsumption(
        [{ id: "only", expiryDate: "2026-08-01", availableQuantity: 1.5 }],
        2,
      ),
    ).toThrow("INSUFFICIENT_BATCH_STOCK");
  });
});
