import { expect, test } from "bun:test";
import { createOrderSchema } from "./order";

const productId = "00000000-0000-4000-8000-000000000001";
const warehouseId = "00000000-0000-4000-8000-000000000002";
const line = { productId, unitName: "cây", unitMultiplier: 4, unitPrice: 45000 };
const request = {
  warehouseId,
  items: [{ productId, unitName: "cây", quantity: 2 }],
  payment: { method: "cash", amount: 90000 },
};

test("checkout preserves the seller's acknowledged pricing snapshot", () => {
  const expectedPricing = { version: 1, lines: [line] };
  expect(createOrderSchema.parse({ ...request, expectedPricing }).expectedPricing)
    .toEqual(expectedPricing);
});

test("legacy and queued orders without a snapshot remain parseable", () => {
  expect(createOrderSchema.safeParse(request).success).toBe(true);
});

test("zero price and fractional factors remain valid", () => {
  const expectedPricing = { version: 1, lines: [{ ...line, unitPrice: 0, unitMultiplier: 0.25 }] };
  expect(createOrderSchema.parse({ ...request, expectedPricing }).expectedPricing)
    .toEqual(expectedPricing);
});

test("malformed, incomplete, reordered or unsupported snapshots fail closed", () => {
  for (const expectedPricing of [
    { version: 2, lines: [line] },
    { version: 1, lines: [] },
    { version: 1, lines: [line, line] },
    { version: 1, lines: [{ ...line, productId: warehouseId }] },
    { version: 1, lines: [{ ...line, unitName: "m" }] },
    { version: 1, lines: [{ ...line, unitMultiplier: 0 }] },
    { version: 1, lines: [{ ...line, unitPrice: -1 }] },
    { version: 1, lines: [{ ...line, unitPrice: null }] },
    { version: 1, lines: [{ ...line, unitPrice: Number.NaN }] },
    { version: 1, lines: [{ ...line, unitPrice: Number.POSITIVE_INFINITY }] },
  ]) expect(createOrderSchema.safeParse({ ...request, expectedPricing }).success).toBe(false);
});
