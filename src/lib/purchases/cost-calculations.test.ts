import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { calculatePurchaseCosts, replayMovingAverage } from "./cost-calculations";

describe("purchase landed costs", () => {
  test("includes both discounts, VAT and freight without changing gross prices", () => {
    const result = calculatePurchaseCosts({
      items: [{ quantity: 2, unitCost: 100, discount: 20 }, { quantity: 1, unitCost: 120, discount: 0 }],
      discount: 30, vatRate: 10, shippingFee: 15,
    });
    assert.deepEqual(result, {
      subtotal: 300, afterDiscount: 270, discount: 30, tax: 27, shippingFee: 15, total: 312,
      lines: [
        { quantity: 2, grossUnitCost: 100, netTotal: 180, invoiceDiscount: 18, tax: 16.2, shippingFee: 9, landedTotal: 187.2, landedUnitCost: 93.6 },
        { quantity: 1, grossUnitCost: 120, netTotal: 120, invoiceDiscount: 12, tax: 10.8, shippingFee: 6, landedTotal: 124.8, landedUnitCost: 124.8 },
      ],
    });
  });

  test("distributes remainder cents deterministically and preserves every invoice total", () => {
    const result = calculatePurchaseCosts({
      items: Array.from({ length: 3 }, () => ({ quantity: 1, unitCost: 1, discount: 0 })),
      discount: 0.01, vatRate: 20, shippingFee: 0.02,
    });
    assert.equal(result.tax, 1); // Existing receipt VAT rounds to whole VND.
    assert.deepEqual(result.lines.map((line) => line.invoiceDiscount), [0.01, 0, 0]);
    assert.deepEqual(result.lines.map((line) => line.shippingFee), [0.01, 0.01, 0]);
    assert.equal(result.lines.reduce((sum, line) => sum + Math.round(line.landedTotal * 100), 0), 401);
    for (const field of ["invoiceDiscount", "tax", "shippingFee"] as const) {
      const total = field === "invoiceDiscount" ? result.discount : result[field];
      assert.equal(result.lines.reduce((sum, line) => sum + Math.round(line[field] * 100), 0), Math.round(total * 100));
    }
  });

  test("uses quantities to allocate freight on a free receipt", () => {
    const result = calculatePurchaseCosts({
      items: [{ quantity: 0.5, unitCost: 100, discount: 50 }, { quantity: 1.5, unitCost: 0, discount: 0 }],
      discount: 20, vatRate: 10, shippingFee: 10,
    });
    assert.equal(result.discount, 0);
    assert.equal(result.tax, 0);
    assert.deepEqual(result.lines.map((line) => line.shippingFee), [2.5, 7.5]);
    assert.deepEqual(result.lines.map((line) => line.landedUnitCost), [5, 5]);
  });

  test("caps discounts at the amount actually payable and retains genuine zero cost", () => {
    const result = calculatePurchaseCosts({ items: [{ quantity: 1, unitCost: 10, discount: 2 }], discount: 50, vatRate: 10 });
    assert.equal(result.discount, 8);
    assert.equal(result.total, 0);
    assert.equal(result.lines[0].landedUnitCost, 0);
    assert.equal(result.lines[0].grossUnitCost, 10);
    const free = calculatePurchaseCosts({ items: [{ quantity: 1, unitCost: 0, discount: 0 }], discount: 0, vatRate: 0 });
    assert.equal(free.lines[0].landedUnitCost, 0);
  });

  test("preserves fractional per-unit landed cost until callers store the average", () => {
    const result = calculatePurchaseCosts({ items: [{ quantity: 3, unitCost: 1, discount: 0 }], discount: 0, vatRate: 0, shippingFee: 0.01 });
    assert.equal(result.lines[0].landedTotal, 3.01);
    assert.equal(result.lines[0].landedUnitCost, 3.01 / 3);
  });

  test("rejects invalid quantities, non-finite amounts and unsafe currency values", () => {
    const valid = { items: [{ quantity: 1, unitCost: 100, discount: 0 }], discount: 0, vatRate: 0 };
    for (const quantity of [0, -1, NaN, Infinity]) {
      assert.throws(() => calculatePurchaseCosts({ ...valid, items: [{ ...valid.items[0], quantity }] }));
    }
    for (const unitCost of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => calculatePurchaseCosts({ ...valid, items: [{ ...valid.items[0], unitCost }] }));
    }
    for (const field of ["discount", "vatRate", "shippingFee"] as const) {
      assert.throws(() => calculatePurchaseCosts({ ...valid, [field]: -1 }));
      assert.throws(() => calculatePurchaseCosts({ ...valid, [field]: Infinity }));
    }
    assert.throws(() => calculatePurchaseCosts({ ...valid, items: [] }));
  });
});

describe("moving average replay", () => {
  test("weights incoming landed cost against remaining stock rather than historic receipt quantity", () => {
    assert.deepEqual(replayMovingAverage({ quantity: 10, unitCost: 100 }, [
      { kind: "movement", quantity: -5 }, { kind: "receipt", quantity: 5, unitCost: 200 },
    ]), { quantity: 10, unitCost: 150 });
  });

  test("replaying without a canceled old receipt accounts for intervening sales", () => {
    const opening = { quantity: 100, unitCost: 100 };
    const events = [
      { id: "old", kind: "receipt", quantity: 100, unitCost: 200 },
      { id: "sale", kind: "movement", quantity: -100 },
      { id: "new", kind: "receipt", quantity: 100, unitCost: 300 },
    ] as const;
    assert.deepEqual(replayMovingAverage(opening, events), { quantity: 200, unitCost: 225 });
    assert.deepEqual(replayMovingAverage(opening, events.filter((event) => event.id !== "old")), { quantity: 100, unitCost: 300 });
  });

  test("keeps average at zero stock and uses incoming cost after depletion or negative stock", () => {
    assert.deepEqual(replayMovingAverage({ quantity: 5, unitCost: 100 }, [{ kind: "movement", quantity: -5 }]), { quantity: 0, unitCost: 100 });
    assert.deepEqual(replayMovingAverage({ quantity: -5, unitCost: 100 }, [{ kind: "receipt", quantity: 2, unitCost: 200 }]), { quantity: -3, unitCost: 200 });
    assert.deepEqual(replayMovingAverage({ quantity: -5, unitCost: 100 }, [{ kind: "receipt", quantity: 10, unitCost: 200 }]), { quantity: 5, unitCost: 200 });
  });

  test("includes free receipts and never treats a missing receipt cost as zero", () => {
    assert.deepEqual(replayMovingAverage({ quantity: 1, unitCost: 100 }, [{ kind: "receipt", quantity: 1, unitCost: 0 }]), { quantity: 2, unitCost: 50 });
    assert.throws(() => replayMovingAverage({ quantity: 1, unitCost: 100 }, [{ kind: "receipt", quantity: 1 }]));
    assert.throws(() => replayMovingAverage({ quantity: 1, unitCost: 100 }, [{ kind: "receipt", quantity: 1, unitCost: null }]));
    assert.throws(() => replayMovingAverage({ quantity: 1, unitCost: 100 }, [{ kind: "receipt", quantity: -1, unitCost: 100 }]));
    assert.throws(() => replayMovingAverage({ quantity: 1, unitCost: 100 }, [{ kind: "movement", quantity: NaN }]));
  });
});
