import { describe, expect, test } from "bun:test";
import {
  createLinePriceEditorState,
  resolveLinePriceEditor,
  setLineFree,
  setLinePriceInput,
} from "@/lib/pos/line-price-editor";
import { buildPosOrderItemPayload } from "@/lib/pos/order-item-payload";

describe("POS free line", () => {
  test("applies zero price and restores the draft when Free is unchecked", () => {
    const initial = createLinePriceEditorState(15_000, 1_000);
    const free = setLineFree(initial, true);

    expect(resolveLinePriceEditor(free)).toEqual({
      unitPrice: 0,
      lineDiscount: 0,
      sellPrice: 0,
    });

    expect(resolveLinePriceEditor(setLineFree(free, false))).toEqual({
      unitPrice: 15_000,
      lineDiscount: 1_000,
      sellPrice: 14_000,
    });
  });

  test("treats direct zero entry as Free", () => {
    const state = setLinePriceInput(
      createLinePriceEditorState(15_000, 0),
      "0",
    );

    expect(state.free).toBe(true);
    expect(resolveLinePriceEditor(state).sellPrice).toBe(0);
  });

  test("keeps zero as an explicit manual unit price", () => {
    expect(buildPosOrderItemPayload({
      product: { id: "product-1", name: "Free bracket" },
      unitName: "cái",
      unitMultiplier: 1,
      quantity: 1,
      unitPrice: 0,
      lineDiscount: 0,
      manualPrice: true,
    })).toEqual({
      productId: "product-1",
      productName: "Free bracket",
      unitName: "cái",
      unitMultiplier: 1,
      quantity: 1,
      manualUnitPrice: 0,
      lineDiscount: 0,
    });
  });
});
