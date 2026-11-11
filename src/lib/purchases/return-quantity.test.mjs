import { expect, test } from "bun:test";
import { remainingLinkedPurchaseQuantities, validateLinkedPurchaseReturn } from "./return-quantity";

const source = [
  { id: "line-1", productId: "tile", quantity: "100", unitMultiplier: "1" },
];
const returned = (n, id = "line-1") => ({
  purchaseOrderItemId: id, productId: "tile", quantity: n, unitMultiplier: 1,
});

test("can return 30 then 70, but not 71 or any more after full return", () => {
  expect(validateLinkedPurchaseReturn(source, [], [returned(30)]).ok).toBe(true);
  expect(validateLinkedPurchaseReturn(source, [returned(30)], [returned(70)]).ok).toBe(true);
  expect(validateLinkedPurchaseReturn(source, [returned(30)], [returned(71)])).toEqual({
    ok: false, error: "RETURN_QTY_EXCEEDS",
  });
  expect(validateLinkedPurchaseReturn(source, [returned(30), returned(70)], [returned(1)])).toEqual({
    ok: false, error: "RETURN_QTY_EXCEEDS",
  });
  expect(remainingLinkedPurchaseQuantities(source, [returned(30)])["line-1"]).toBe(70);
  expect(remainingLinkedPurchaseQuantities(source, [returned(30), returned(70)])["line-1"]).toBe(0);
});

test("multiple return documents and duplicate request lines share one receipt limit", () => {
  const duplicate = [returned(40), returned(60)];
  expect(validateLinkedPurchaseReturn(source, [], duplicate).ok).toBe(true);
  expect(validateLinkedPurchaseReturn(source, [returned(80)], [returned(15), returned(10)])).toEqual({
    ok: false, error: "RETURN_QTY_EXCEEDS",
  });
});

test("compares quantities in base units when selling unit differs", () => {
  const packs = [{ id: "line-1", productId: "tile", quantity: 10, unitMultiplier: 10 }];
  expect(validateLinkedPurchaseReturn(packs, [returned(3)], [
    { ...returned(9), unitMultiplier: 10 },
  ]).toEqual({ ok: true, normalized: [{ ...returned(9), unitMultiplier: 10 }] });
  expect(validateLinkedPurchaseReturn(packs, [returned(20)], [
    { ...returned(9), unitMultiplier: 10 },
  ])).toEqual({ ok: false, error: "RETURN_QTY_EXCEEDS" });
});

test("one purchase can contain two lines for the same product without over-returning either", () => {
  const rows = [
    { id: "line-1", productId: "tile", quantity: 30, unitMultiplier: 1 },
    { id: "line-2", productId: "tile", quantity: 70, unitMultiplier: 1 },
  ];
  const prev = [{ ...returned(20), purchaseOrderItemId: "line-1" }];
  expect(validateLinkedPurchaseReturn(rows, prev, [{ ...returned(10), purchaseOrderItemId: "line-1" }, returned(70, "line-2")]).ok).toBe(true);
  expect(validateLinkedPurchaseReturn(rows, prev, [returned(11, "line-1")])).toEqual({
    ok: false, error: "RETURN_QTY_EXCEEDS",
  });
  expect(validateLinkedPurchaseReturn(rows, prev, [{ ...returned(1), purchaseOrderItemId: null }])).toEqual({
    ok: false, error: "PRODUCT_NOT_FOUND",
  });
});

test("legacy returns lacking a receipt-line reference still consume source capacity", () => {
  const legacy = [{ productId: "tile", purchaseOrderItemId: null, quantity: 80, unitMultiplier: 1 }];
  expect(validateLinkedPurchaseReturn(source, legacy, [returned(21)])).toEqual({
    ok: false, error: "RETURN_QTY_EXCEEDS",
  });
  expect(remainingLinkedPurchaseQuantities(source, legacy)["line-1"]).toBe(20);
});

test("editing a posted return excludes only its own old lines from cumulative validation", () => {
  // The caller filters the edited return ID in its SQL query before checking.
  const otherReturns = [returned(25)];
  const edited = returned(75);
  expect(validateLinkedPurchaseReturn(source, otherReturns, [edited]).ok).toBe(true);
  expect(validateLinkedPurchaseReturn(source, otherReturns, [returned(76)])).toEqual({
    ok: false, error: "RETURN_QTY_EXCEEDS",
  });
});

test("rejects products not in the source receipt and incorrect item references", () => {
  expect(validateLinkedPurchaseReturn(source, [], [{ productId: "other", quantity: 1, unitMultiplier: 1 }])).toEqual({
    ok: false, error: "PRODUCT_NOT_FOUND",
  });
  expect(validateLinkedPurchaseReturn(source, [], [returned(1, "other-line")])).toEqual({
    ok: false, error: "PRODUCT_NOT_FOUND",
  });
  const inferred = { productId: "tile", quantity: 2, unitMultiplier: 1 };
  expect(validateLinkedPurchaseReturn(source, [], [inferred])).toEqual({
    ok: true, normalized: [{ ...inferred, purchaseOrderItemId: "line-1" }],
  });
});
