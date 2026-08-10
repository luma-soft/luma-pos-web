import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storeFeatures, storeSettings, stores } from "@/db/schema";
import { CURRENT_STORE_ID } from "@/lib/tenancy/constants";
import type { StoreFeatureKey } from "@/lib/tenancy/store-features";

export type PublicStore = { id: string; slug: string; name: string };

async function resolvePublicStore(
  predicate: ReturnType<typeof eq>,
  feature: StoreFeatureKey,
): Promise<PublicStore | null> {
  const [store] = await db
    .select({ id: stores.id, slug: stores.slug, name: storeSettings.name })
    .from(stores)
    .innerJoin(storeSettings, eq(storeSettings.storeId, stores.id))
    .innerJoin(storeFeatures, and(
      eq(storeFeatures.storeId, stores.id),
      eq(storeFeatures.featureKey, feature),
      eq(storeFeatures.enabled, true),
    ))
    .where(and(eq(stores.status, "active"), predicate))
    .limit(1);
  return store ?? null;
}

export function resolvePublicStoreBySlug(slug: string, feature: StoreFeatureKey) {
  return resolvePublicStore(eq(stores.slug, slug), feature);
}

export function resolveLegacyCurrentPublicStore(feature: StoreFeatureKey) {
  return resolvePublicStore(eq(stores.id, CURRENT_STORE_ID), feature);
}
