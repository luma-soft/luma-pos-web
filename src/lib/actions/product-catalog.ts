"use server";

import { getProductCatalogSnapshot } from "@/lib/data/product-catalog";
import type { ProductCatalogSnapshot } from "@/lib/product-catalog";
import { getRole, requireUser } from "@/lib/actions/common";

export async function syncProductCatalog(): Promise<ProductCatalogSnapshot | null> {
  try {
    const user = await requireUser();
    const role = await getRole(user.id);
    return getProductCatalogSnapshot(user.id, role);
  } catch {
    return null;
  }
}
