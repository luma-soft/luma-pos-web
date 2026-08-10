"use server";

import {
  getProductCatalogRevision,
  getProductCatalogSnapshot,
} from "@/lib/data/product-catalog";
import type { ProductCatalogSnapshot } from "@/lib/product-catalog";
import { requireStoreContext } from "@/lib/auth/store-context";

export async function syncProductCatalog(): Promise<ProductCatalogSnapshot | null> {
  try {
    const context = await requireStoreContext();
    return getProductCatalogSnapshot(context.storeId, context.userId, context.role);
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
