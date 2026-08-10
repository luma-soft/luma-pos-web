import { notFound } from "next/navigation";
import { requireStoreFeature } from "@/lib/auth/store-context";
import type { StoreFeatureKey } from "@/lib/tenancy/store-features";

export async function requirePageFeature(feature: StoreFeatureKey) {
  try {
    return await requireStoreFeature(feature);
  } catch {
    notFound();
  }
}
