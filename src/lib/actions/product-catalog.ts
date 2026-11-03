"use server";

import {
  getProductCatalogDelta,
  getProductCatalogRevision,
  getProductCatalogSnapshot,
} from "@/lib/data/product-catalog";
import type { ProductCatalogDelta, ProductCatalogSnapshot } from "@/lib/product-catalog";
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
      const revision = await getProductCatalogRevision(context.storeId);
      if (revision === sinceRevision) {
        return {
          mode: "unchanged",
          revision,
          userId: context.userId,
          scopeId: `${context.storeId}:${context.userId}:${context.role}`,
        };
      }
      try {
        const delta = await getProductCatalogDelta(
          context.storeId,
          context.userId,
          context.role,
          sinceRevision,
          revision,
        );
        if (delta) return { mode: "delta", delta };
      } catch {
        // A missing journal or an interrupted replay safely falls back to full.
      }
    }
    return {
      mode: "full",
      snapshot: await getProductCatalogSnapshot(context.storeId, context.userId, context.role),
    };
  } catch {
    return null;
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
