import { describe, expect, test } from "bun:test";
import {
  PRODUCT_SEARCH_DEBOUNCE_MS,
  ProductSearchRequestGate,
  setSelectedProductQuantity,
  shouldSelectProductSearchItem,
  nextProductSearchActiveIndex,
} from "./product-search-state.ts";

describe("shared product search state", () => {
  test("keyboard navigation wraps in both directions", () => {
    expect(nextProductSearchActiveIndex(-1, 3, "next")).toBe(0);
    expect(nextProductSearchActiveIndex(2, 3, "next")).toBe(0);
    expect(nextProductSearchActiveIndex(0, 3, "previous")).toBe(2);
    expect(nextProductSearchActiveIndex(-1, 0, "next")).toBe(-1);
  });

  test("only the latest async request may publish results", () => {
    const gate = new ProductSearchRequestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isLatest(first)).toBeFalse();
    expect(gate.isLatest(second)).toBeTrue();
  });

  test("uses the POS-compatible debounce interval", () => {
    expect(PRODUCT_SEARCH_DEBOUNCE_MS).toBe(250);
  });

  test("does not select an item that is already selected", () => {
    expect(shouldSelectProductSearchItem({ selected: true, disabled: false })).toBeFalse();
    expect(shouldSelectProductSearchItem({ selected: false, disabled: true })).toBeFalse();
    expect(shouldSelectProductSearchItem({ selected: false, disabled: false })).toBeTrue();
  });

  test("removes a selected product when its quantity reaches zero", () => {
    const rows = [{ id: "one", quantity: 1 }, { id: "two", quantity: 2 }];
    expect(setSelectedProductQuantity(rows, 0, (row) => row.id === "one", (row, quantity) => ({ ...row, quantity })))
      .toEqual([{ id: "two", quantity: 2 }]);
    expect(setSelectedProductQuantity(rows, 3, (row) => row.id === "one", (row, quantity) => ({ ...row, quantity })))
      .toEqual([{ id: "one", quantity: 3 }, { id: "two", quantity: 2 }]);
  });
});
