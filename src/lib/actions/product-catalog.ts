"use server";

import {
  getProductCatalogDeltaV2,
  getProductCatalogRevision,
  getProductCatalogSnapshot,
} from "@/lib/data/product-catalog";
import { productCatalogScopeId, type ProductCatalogDelta, type ProductCatalogSnapshot } from "@/lib/product-catalog";
import { requireStoreContext } from "@/lib/auth/store-context";

export type ProductCatalogSyncResult =
  | { mode: "full"; snapshot: ProductCatalogSnapshot }
  | { mode: "unchanged"; revision: string; userId: string; scopeId: string }
  | { mode: "delta"; delta: ProductCatalogDelta };

export async function syncProductCatalog(
  sinceRevision?: string | null,
): Promise<ProductCatalogSyncResult | null> {
  try {
    const context = await requireStoreContext();
    if (sinceRevision && /^\d+$/.test(sinceRevision)) {
      let revision = await getProductCatalogRevision(context.storeId);
      if (revision === sinceRevision) {
        return {
          mode: "unchanged",
          revision,
          userId: context.userId,
          scopeId: productCatalogScopeId(context.storeId, context.userId, context.role),
        };
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let cursor = sinceRevision;
        const pages: ProductCatalogDelta[] = [];
        let complete = false;
        try {
          for (let page = 0; page < 20; page += 1) {
            const delta = await getProductCatalogDeltaV2(
              context.storeId,
              context.userId,
              context.role,
              cursor,
              revision,
            );
            if (!delta) break;
            pages.push(delta);
            cursor = delta.revision;
            if (!delta.hasMore) {
              complete = true;
              break;
            }
          }
        } catch {
          break;
        }
        if (complete) {
          return {
            mode: "delta",
            delta: combineProductCatalogDeltas(pages, sinceRevision, revision),
          };
        }

        // A revision that changed during hydration can be replayed safely from
        // the original committed cursor. Retry against the new bounded target
        // before falling back to a full snapshot for an expired/invalid journal.
        try {
          const latestRevision = await getProductCatalogRevision(context.storeId);
          if (latestRevision !== revision) {
            revision = latestRevision;
            continue;
          }
        } catch {
          // The complete snapshot path below remains the safe recovery.
        }
        break;
      }
    }
    return {
      mode: "full",
      // Inventory needs every lifecycle state; POS still applies its own
      // authorized sellability filter when selecting products.
      snapshot: await getProductCatalogSnapshot(context.storeId, context.userId, context.role, {
        includeInactive: true,
      }),
    };
  } catch {
    return null;
  }
}

function combineProductCatalogDeltas(
  pages: readonly ProductCatalogDelta[],
  baseRevision: string,
  revision: string,
): ProductCatalogDelta {
  const first = pages[0];
  if (!first) throw new Error("PRODUCT_CATALOG_DELTA_PAGE_MISSING");
  const products = new Map<string, ProductCatalogDelta["upserts"][number]>();
  const deleted = new Set<string>();
  const metadata = {
    categories: new Map<string, { id: string; name: string }>(),
    brands: new Map<string, { id: string; name: string }>(),
    suppliers: new Map<string, { id: string; name: string }>(),
    warehouses: new Map<string, { id: string; name: string; isDefault: boolean }>(),
  };
  const metadataDeleted = {
    categories: new Set<string>(),
    brands: new Set<string>(),
    suppliers: new Set<string>(),
    warehouses: new Set<string>(),
  };

  for (const page of pages) {
    for (const id of page.deletedIds) {
      products.delete(id);
      deleted.add(id);
    }
    for (const product of page.upserts) {
      deleted.delete(product.id);
      products.set(product.id, product);
    }
    applyMetadataChange(metadata.categories, metadataDeleted.categories, page.metadata?.categories);
    applyMetadataChange(metadata.brands, metadataDeleted.brands, page.metadata?.brands);
    applyMetadataChange(metadata.suppliers, metadataDeleted.suppliers, page.metadata?.suppliers);
    applyMetadataChange(metadata.warehouses, metadataDeleted.warehouses, page.metadata?.warehouses);
  }

  const metadataChanges = Object.fromEntries(
    (["categories", "brands", "suppliers", "warehouses"] as const)
      .filter((key) => pages.some((page) => page.metadata?.[key]))
      .map((key) => [key, {
        upserts: [...metadata[key].values()],
        deletedIds: [...metadataDeleted[key]],
      }]),
  ) as NonNullable<ProductCatalogDelta["metadata"]>;
  return {
    baseRevision,
    revision,
    schemaVersion: first.schemaVersion,
    userId: first.userId,
    scopeId: first.scopeId,
    upserts: [...products.values()],
    deletedIds: [...deleted],
    metadata: metadataChanges,
    hasMore: false,
  };
}

function applyMetadataChange<T extends { id: string }>(
  current: Map<string, T>,
  deleted: Set<string>,
  change: { upserts: T[]; deletedIds: string[] } | undefined,
) {
  if (!change) return;
  for (const id of change.deletedIds) {
    current.delete(id);
    deleted.add(id);
  }
  for (const item of change.upserts) {
    deleted.delete(item.id);
    current.set(item.id, item);
  }
}

export async function checkProductCatalogRevision(): Promise<string | null> {
  try {
    const context = await requireStoreContext();
    return getProductCatalogRevision(context.storeId);
  } catch {
    return null;
  }
}
