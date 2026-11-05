// Pure, fail-closed replay validation. A missing revision or global marker
// must cause a full snapshot, never an incomplete patch at the client.
export type CatalogDeltaEvent = {
  revision: number;
  productId: string | null;
  requiresFull: boolean;
};

export type CatalogDeltaEventV2 = {
  revision: number;
  changeKind: string | null;
  entityType: string | null;
  entityId: string | null;
  affectedProductIds: readonly string[] | null;
  requiresFullV2: boolean;
};

export type CatalogDeltaBatch = {
  fromRevision: string;
  toRevision: string;
  productIds: string[];
  metadataIds: Partial<Record<"categories" | "brands" | "suppliers" | "warehouses", string[]>>;
  hasMore: boolean;
};

const METADATA_ENTITY_TYPES = new Set(["categories", "brands", "suppliers", "warehouses"]);

/** Validate and coalesce one bounded V2 journal page. */
export function replayCatalogDeltaBatch(
  sinceRevision: number,
  targetRevision: number,
  events: readonly CatalogDeltaEventV2[],
  pageSize = 200,
  maximumProducts = 300,
): CatalogDeltaBatch | null {
  if (!Number.isSafeInteger(sinceRevision) || !Number.isSafeInteger(targetRevision) ||
      sinceRevision < 0 || targetRevision <= sinceRevision ||
      events.length === 0 || events.length > pageSize + 1) return null;

  const page = events.slice(0, pageSize);
  const productIds = new Set<string>();
  const metadataIds: CatalogDeltaBatch["metadataIds"] = {};
  let previous = sinceRevision;
  for (const event of page) {
    if (event.revision !== previous + 1 || event.requiresFullV2 || !event.changeKind) return null;
    previous = event.revision;
    for (const id of event.affectedProductIds ?? []) {
      if (!id) return null;
      productIds.add(id);
      if (productIds.size > maximumProducts) return null;
    }
    if (event.entityType && METADATA_ENTITY_TYPES.has(event.entityType)) {
      if (!event.entityId) return null;
      const key = event.entityType as keyof typeof metadataIds;
      metadataIds[key] = [...(metadataIds[key] ?? []), event.entityId];
    }
    if (event.changeKind === "product" && !event.affectedProductIds?.length && event.entityId) {
      productIds.add(event.entityId);
      if (productIds.size > maximumProducts) return null;
    }
  }

  if (previous === sinceRevision) return null;
  return {
    fromRevision: String(sinceRevision),
    toRevision: String(previous),
    productIds: [...productIds],
    metadataIds: Object.fromEntries(Object.entries(metadataIds).map(([key, ids]) => [key, [...new Set(ids)]])),
    hasMore: previous < targetRevision,
  };
}

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
