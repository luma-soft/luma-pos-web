import { expect, test } from "bun:test";
import { buildPosOrderItemPayload } from "./order-item-payload";
import { createLinePriceEditorState, resolveLinePriceEditor, setLineFree } from "./line-price-editor";
import { orderItemSchema } from "../schemas/order";

test("percent discount survives editing, saving, and reopening", () => {
  const editor = createLinePriceEditorState(100_000, 20_000, "pct", 20);
  expect(editor.discount).toBe("20");
  expect(editor.discountMode).toBe("pct");
  const resolved = resolveLinePriceEditor(editor);
  expect(resolved).toMatchObject({ unitPrice: 100_000, lineDiscount: 20_000, sellPrice: 80_000, lineDiscountMode: "pct", lineDiscountValue: 20 });
  const payload = buildPosOrderItemPayload({
    product: { id: "product", name: "Ống Tiền Phong" }, unitName: "cây", unitMultiplier: 1,
    quantity: 3, unitPrice: resolved.unitPrice, lineDiscount: resolved.lineDiscount,
    lineDiscountMode: resolved.lineDiscountMode, lineDiscountValue: resolved.lineDiscountValue,
  });
  expect(payload).toMatchObject({ lineDiscountMode: "pct", lineDiscountValue: 20, lineDiscount: 20_000 });
  expect(payload.manualUnitPrice).toBeUndefined();
});

test("discount calculation uses the same precision that can be reopened from a snapshot", () => {
  expect(resolveLinePriceEditor(createLinePriceEditorState(100_000, 0, "pct", 20.125)))
    .toMatchObject({ lineDiscountValue: 20.13, lineDiscount: 20130, sellPrice: 79870 });
});

test("discount mode cannot be submitted without its value", () => {
  const line = { productId: "10000000-0000-4000-8000-000000000001", unitName: "cây", quantity: 1 };
  expect(orderItemSchema.safeParse({ ...line, lineDiscount: 20000 }).success).toBe(true);
  expect(orderItemSchema.safeParse({ ...line, lineDiscountMode: "pct" }).success).toBe(false);
  expect(orderItemSchema.safeParse({ ...line, lineDiscountValue: 20 }).success).toBe(false);
  expect(orderItemSchema.safeParse({ ...line, lineDiscountMode: "pct", lineDiscountValue: 20 }).success).toBe(true);
});

test("free line restores the entered percentage and clamps discounts to the selling price", () => {
  const initial = createLinePriceEditorState(100_000, 20_000, "pct", 20);
  expect(setLineFree(setLineFree(initial, true), false)).toMatchObject(initial);
  expect(resolveLinePriceEditor({ ...initial, discount: "150" })).toMatchObject({ sellPrice: 0, lineDiscount: 100_000, lineDiscountValue: 100 });
  expect(resolveLinePriceEditor({ ...initial, discountMode: "vnd", discount: "200000" })).toMatchObject({ sellPrice: 0, lineDiscount: 100_000, lineDiscountValue: 100_000 });
});
