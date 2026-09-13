export function canAddCatalogProductsToPosDraft(kind: string): boolean {
  return kind !== "return_invoice";
}
