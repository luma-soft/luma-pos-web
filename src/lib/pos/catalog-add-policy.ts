export function canAddCatalogProductsToPosDraft(kind: string): boolean {
  return kind !== "return_invoice";
}

export function canEditPriceBookForPosDraft(kind: string): boolean {
  return kind !== "return_invoice";
}
