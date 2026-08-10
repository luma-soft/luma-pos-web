import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { createClient as createBearerClient, type User } from "@supabase/supabase-js";
import { db } from "@/db";
import { profiles, storeFeatures, storeSettings, stores } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import {
  activeStorePrincipal,
  type StorePrincipal,
} from "@/lib/auth/store-context-policy";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import {
  resolveStoreFeatures,
  storeFeatureEnabled,
  type StoreFeatureKey,
  type StoreFeatureSet,
} from "@/lib/tenancy/store-features";

export type StoreContext = StorePrincipal & {
  fullName: string;
  storeSlug: string;
  storeName: string;
  features: StoreFeatureSet;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("UNAUTHORIZED");
  }
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const authorization = (await headers()).get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (bearer) {
    const supabase = createBearerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    return (await supabase.auth.getUser(bearer)).data.user;
  }

  const supabase = await createCookieClient();
  return (await supabase.auth.getUser()).data.user;
}

export async function resolveStoreContextForUser(
  userId: string,
): Promise<StoreContext | null> {
  const [row] = await db
    .select({
      userId: profiles.id,
      fullName: profiles.fullName,
      storeId: profiles.storeId,
      role: profiles.role,
      profileActive: profiles.isActive,
      storeStatus: stores.status,
      storeSlug: stores.slug,
      storeName: storeSettings.name,
    })
    .from(profiles)
    .innerJoin(stores, eq(stores.id, profiles.storeId))
    .leftJoin(storeSettings, eq(storeSettings.storeId, stores.id))
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!row) return null;

  const principal = activeStorePrincipal(row);
  if (!principal) return null;

  const featureRows = await db
    .select({ featureKey: storeFeatures.featureKey, enabled: storeFeatures.enabled })
    .from(storeFeatures)
    .where(eq(storeFeatures.storeId, principal.storeId));

  return {
    ...principal,
    fullName: row.fullName,
    storeSlug: row.storeSlug,
    storeName: row.storeName ?? "",
    features: resolveStoreFeatures(featureRows),
  };
}

export async function requireStoreContext(): Promise<StoreContext> {
  const user = await getAuthenticatedUser();
  if (!user) throw new UnauthorizedError();
  const context = await resolveStoreContextForUser(user.id);
  if (!context) throw new UnauthorizedError();
  return context;
}

export async function requireStoreRole(roles: readonly Role[]): Promise<StoreContext> {
  const context = await requireStoreContext();
  if (!roles.includes(context.role)) throw new UnauthorizedError();
  return context;
}

export async function requireStoreFeature(
  featureKey: StoreFeatureKey,
): Promise<StoreContext> {
  const context = await requireStoreContext();
  if (!storeFeatureEnabled(context.features, featureKey)) {
    throw new Error("FEATURE_DISABLED");
  }
  return context;
}

export async function requireStoreFeatureRole(
  featureKey: StoreFeatureKey,
  roles: readonly Role[],
): Promise<StoreContext> {
  const context = await requireStoreFeature(featureKey);
  if (!roles.includes(context.role)) throw new UnauthorizedError();
  return context;
}

export async function profilesBelongToStore(
  storeId: string,
  profileIds: readonly string[],
): Promise<boolean> {
  if (profileIds.length === 0) return true;
  const rows = await Promise.all(profileIds.map(async (profileId) => {
    const [profile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.id, profileId), eq(profiles.storeId, storeId)))
      .limit(1);
    return profile;
  }));
  return rows.every(Boolean);
}
