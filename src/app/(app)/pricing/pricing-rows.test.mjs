import { describe, expect, test } from "bun:test";
import { reconcilePricingRows } from "./pricing-rows";

const row = {
  id: "p1", sku: "SP001", name: "Ống nhựa", baseUnit: "m",
  costPrice: 90000, lastPurchase: null,
  prices: { cost: 90000, purchase: null, list: 140000, retail: 120000 },
};

describe("pricing refresh reconciliation", () => {
  test("refreshes untouched cells after a bulk formula or external update", () => {
    const incoming = [{ ...row, costPrice: 95000, prices: { ...row.prices, cost: 95000, list: 150000, retail: 130000 } }];
    expect(reconcilePricingRows([row], [row], incoming)).toEqual(incoming);
  });

  test("keeps a draft in another cell while the saved cell is acknowledged", () => {
    const local = { ...row, prices: { ...row.prices, list: 150000, retail: 123000 } };
    const incoming = { ...row, prices: { ...row.prices, list: 150000 } };
    const merged = reconcilePricingRows([local], [row], [incoming]);
    expect(merged[0].prices).toEqual({ cost: 90000, purchase: null, list: 150000, retail: 123000 });
    const bulk = { ...incoming, prices: { ...incoming.prices, list: 160000 } };
    expect(reconcilePricingRows(merged, [incoming], [bulk])[0].prices.list).toBe(160000);
  });

  test("preserves an explicit clear and zero instead of restoring the previous price", () => {
    for (const price of [null, 0]) {
      const local = { ...row, prices: { ...row.prices, list: price } };
      expect(reconcilePricingRows([local], [row], [row])[0].prices.list).toBe(price);
    }
  });

  test("uses the server row order and removes missing rows, retaining new rows", () => {
    const next = { ...row, id: "p2", sku: "SP002" };
    expect(reconcilePricingRows([row], [row], [next])).toEqual([next]);
    expect(reconcilePricingRows([row, next], [row, next], [next, row]).map((item) => item.id)).toEqual(["p2", "p1"]);
  });

  test("does not mutate any snapshot", () => {
    const local = { ...row, prices: { ...row.prices, list: 150000 } };
    const before = JSON.stringify([local, row]);
    reconcilePricingRows([local], [row], [row]);
    expect(JSON.stringify([local, row])).toBe(before);
  });
});
