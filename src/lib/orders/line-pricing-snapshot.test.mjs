import { expect, test } from "bun:test";
import { readOrderLinePricing } from "./line-pricing-snapshot";

test("new snapshots keep original company price and entered percent without reducing net price twice", () => {
  expect(readOrderLinePricing({ quantity: "3", unitPrice: "80000", total: "240000", discount: "60000", preDiscountUnitPrice: "100000", lineDiscountMode: "pct", lineDiscountValue: "20" }))
    .toEqual({ unitPrice: 100_000, netUnitPrice: 80_000, lineDiscount: 20_000, discount: 60_000, lineDiscountMode: "pct", lineDiscountValue: 20 });
});

test("legacy imported gross price infers discount from saved total, irrespective of legacy discount units", () => {
  expect(readOrderLinePricing({ quantity: "3", unitPrice: "100000", total: "240000", discount: "20000" }))
    .toEqual({ unitPrice: 100_000, netUnitPrice: 80_000, lineDiscount: 20_000, discount: 60_000, lineDiscountMode: "vnd", lineDiscountValue: 20_000 });
});

test("old POS net-only rows are not discounted a second time", () => {
  expect(readOrderLinePricing({ quantity: "3", unitPrice: "80000", total: "240000", discount: "0" }))
    .toMatchObject({ unitPrice: 80_000, netUnitPrice: 80_000, lineDiscount: 0, discount: 0 });
});
