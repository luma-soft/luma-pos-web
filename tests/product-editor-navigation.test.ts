import { describe, expect, test } from "bun:test";
import { productEditorCloseHref } from "@/lib/product-editor-navigation";

describe("product editor close navigation", () => {
  test("closes a page-level editor back to the product list", () => {
    expect(productEditorCloseHref("page", "product-123")).toBe(
      "/inventory?tab=products",
    );
  });

  test("closes an editor stacked over a detail modal back to that modal", () => {
    expect(productEditorCloseHref("modal", "product-123")).toBe(
      "/products/product-123",
    );
  });
});
