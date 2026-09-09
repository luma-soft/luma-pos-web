import { describe, expect, test } from "bun:test";
import { shouldHandleProductModalEscape } from "./product-modal-frame";

describe("product modal stack", () => {
  const productDialog = {};
  const childDialog = {};

  test("only the top product dialog handles Escape", () => {
    expect(shouldHandleProductModalEscape(
      { key: "Escape", defaultPrevented: false },
      productDialog,
      [productDialog],
    )).toBe(true);
    expect(shouldHandleProductModalEscape(
      { key: "Escape", defaultPrevented: false },
      productDialog,
      [productDialog, childDialog],
    )).toBe(false);
  });

  test("ignores handled and unrelated keys", () => {
    expect(shouldHandleProductModalEscape(
      { key: "Escape", defaultPrevented: true },
      productDialog,
      [productDialog],
    )).toBe(false);
    expect(shouldHandleProductModalEscape(
      { key: "Enter", defaultPrevented: false },
      productDialog,
      [productDialog],
    )).toBe(false);
  });
});
