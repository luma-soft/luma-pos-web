import { describe, expect, it } from "bun:test";
import { selectRelatedProducts } from "@/lib/products/related-products";

describe("same-type product selection", () => {
  it("uses the KiotViet related-product group instead of the category", () => {
    const selected = {
      id: "pvc-34-c3",
      sku: "SP053359",
      relatedProductId: "pvc-group-root",
    };
    const candidates = [
      { id: "pvc-group-root", sku: "SP000051", relatedProductId: null },
      { id: "pvc-27-c2", sku: "SP000052", relatedProductId: "pvc-group-root" },
      { id: "silver-adapter", sku: "SP000552", relatedProductId: "silver-group-root" },
    ];

    expect(selectRelatedProducts(selected, candidates).map((product) => product.sku))
      .toEqual(["SP000051", "SP000052"]);
  });

  it("returns the complete KiotViet group in SKU order", () => {
    const selected = {
      id: "pvc-group-root",
      sku: "SP000051",
      relatedProductId: null,
    };
    const candidates = Array.from({ length: 14 }, (_, index) => ({
      id: `pvc-${index + 2}`,
      sku: `SP${String(index + 2).padStart(6, "0")}`,
      relatedProductId: "pvc-group-root",
    })).reverse();

    const related = selectRelatedProducts(selected, candidates);

    expect(related).toHaveLength(14);
    expect(related[0]?.sku).toBe("SP000002");
    expect(related.at(-1)?.sku).toBe("SP000015");
  });
});
