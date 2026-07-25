import { describe, expect, test } from "bun:test";
import { productKindChangeBlock } from "@/lib/product-kind-change";

const base = {
  currentKind: "product" as const,
  nextKind: "service" as const,
  totalStock: 0,
  hasVariants: false,
  openDocumentCount: 0,
};

describe("product kind change policy", () => {
  test("allows a clean product to become a service or combo", () => {
    expect(productKindChangeBlock(base)).toBeNull();
    expect(
      productKindChangeBlock({ ...base, nextKind: "combo" }),
    ).toBeNull();
  });

  test("blocks leaving product while physical stock remains", () => {
    expect(
      productKindChangeBlock({ ...base, totalStock: 2 }),
    ).toBe("PRODUCT_KIND_HAS_STOCK");
  });

  test("blocks variants and unfinished documents", () => {
    expect(
      productKindChangeBlock({ ...base, hasVariants: true }),
    ).toBe("PRODUCT_KIND_HAS_VARIANTS");
    expect(
      productKindChangeBlock({ ...base, openDocumentCount: 1 }),
    ).toBe("PRODUCT_KIND_HAS_OPEN_DOCUMENTS");
  });

  test("allows combo and service conversions when clean", () => {
    expect(
      productKindChangeBlock({
        ...base,
        currentKind: "combo",
        nextKind: "product",
      }),
    ).toBeNull();
    expect(
      productKindChangeBlock({
        ...base,
        currentKind: "service",
        nextKind: "combo",
      }),
    ).toBeNull();
  });
});
