import { describe, expect, test } from "bun:test";
import {
  purchaseLineTotal,
  purchaseUnitCostFromTotal,
} from "@/lib/purchases/line-calculations";

describe("editable purchase line total", () => {
  test("recalculates unit cost from quantity", () => {
    const line = { quantity: 4, unitCost: 90_000, discInput: 0, discMode: "vnd" as const };

    const unitCost = purchaseUnitCostFromTotal(line, 600_000);

    expect(unitCost).toBe(150_000);
    expect(purchaseLineTotal({ ...line, unitCost })).toBe(600_000);
  });

  test("recalculates pre-discount unit cost for percentage discount", () => {
    const line = { quantity: 2, unitCost: 90_000, discInput: 10, discMode: "pct" as const };

    const unitCost = purchaseUnitCostFromTotal(line, 180_000);

    expect(unitCost).toBe(100_000);
    expect(purchaseLineTotal({ ...line, unitCost })).toBe(180_000);
  });
});
