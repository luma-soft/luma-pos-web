// Pure, fail-closed replay validation. A missing revision or global marker
// must cause a full snapshot, never an incomplete patch at the client.
export type CatalogDeltaEvent = {
  revision: number;
  productId: string | null;
  requiresFull: boolean;
};

export function changedCatalogProductIds(
  sinceRevision: number,
  targetRevision: number,
  events: readonly CatalogDeltaEvent[],
): string[] | null {
  if (!Number.isSafeInteger(sinceRevision) ||
      !Number.isSafeInteger(targetRevision) ||
      sinceRevision < 0 || targetRevision <= sinceRevision ||
      events.length === 0 || events.length > 2000) return null;

  const ids = new Set<string>();
  let previous = sinceRevision;
  for (const event of events) {
    if (event.revision !== previous + 1 ||
        event.requiresFull || !event.productId) return null;
    ids.add(event.productId);
    if (ids.size > 300) return null;
    previous = event.revision;
  }
  return previous === targetRevision ? [...ids] : null;
}
