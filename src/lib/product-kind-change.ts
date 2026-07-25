export type ProductKind = "product" | "service" | "combo";

export type ProductKindChangeBlock =
  | "PRODUCT_KIND_HAS_VARIANTS"
  | "PRODUCT_KIND_HAS_STOCK"
  | "PRODUCT_KIND_HAS_OPEN_DOCUMENTS";

export function productKindChangeBlock(input: {
  currentKind: ProductKind;
  nextKind: ProductKind;
  totalStock: number;
  hasVariants: boolean;
  openDocumentCount: number;
}): ProductKindChangeBlock | null {
  if (input.currentKind === input.nextKind) return null;
  if (input.hasVariants) return "PRODUCT_KIND_HAS_VARIANTS";
  if (
    input.currentKind === "product" &&
    input.nextKind !== "product" &&
    Math.abs(input.totalStock) > 1e-9
  ) {
    return "PRODUCT_KIND_HAS_STOCK";
  }
  if (input.openDocumentCount > 0) {
    return "PRODUCT_KIND_HAS_OPEN_DOCUMENTS";
  }
  return null;
}
