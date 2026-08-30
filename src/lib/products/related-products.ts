export type RelatedProductCoordinate = {
  id: string;
  sku: string;
  relatedProductId: string | null;
};

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
