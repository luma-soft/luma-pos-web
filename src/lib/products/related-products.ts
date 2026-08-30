export type RelatedProductCoordinate = {
  id: string;
  sku: string;
  relatedProductId: string | null;
};

export function buildRelatedProductLookup(
  hasRelatedProductColumn: boolean,
  products: readonly Pick<RelatedProductCoordinate, "id" | "relatedProductId">[],
): { groupKeys: string[]; rootIds: string[] } | null {
  if (!hasRelatedProductColumn || products.length === 0) return null;

  return {
    groupKeys: [...new Set(products.flatMap((product) => (
      product.relatedProductId
        ? [product.id, product.relatedProductId]
        : [product.id]
    )))],
    rootIds: [...new Set(products.flatMap((product) => (
      product.relatedProductId ? [product.relatedProductId] : []
    )))],
  };
}

export function selectRelatedProducts<
  TProduct extends RelatedProductCoordinate,
  TCandidate extends RelatedProductCoordinate,
>(product: TProduct, candidates: readonly TCandidate[]): TCandidate[] {
  const groupId = product.relatedProductId
    ?? (candidates.some((candidate) => candidate.relatedProductId === product.id)
      ? product.id
      : null);
  if (!groupId) return [];

  return candidates
    .filter((candidate) => (
      candidate.id !== product.id
      && (candidate.id === groupId || candidate.relatedProductId === groupId)
    ))
    .sort((left, right) => left.sku.localeCompare(right.sku, "vi"));
}
