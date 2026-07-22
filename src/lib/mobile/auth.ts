import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { requireRole, type Gate, type Role } from "@/lib/actions/common";
import { activeProfile } from "@/lib/auth/profile-access";
import {
  cashierContextSecret,
  verifyCashierContextToken,
} from "@/lib/auth/cashier-pin";

export type MobileGate = Gate & { principalId?: string };

export async function requireMobileRole(roles: readonly Role[]): Promise<MobileGate> {
  const headerStore = await headers();
  const authorization = headerStore.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token) {
    const gate = await requireRole([...roles]);
    return gate.ok ? { ...gate, principalId: gate.userId } : gate;
  }

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  const { data, error } = await supabase.auth.getUser(token);
  const user = data.user;
  if (error || !user) {
    return { ok: false, error: "errors.unauthorized" };
  }

  const [principalProfile] = await db
    .select({ role: profiles.role, isActive: profiles.isActive })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const activePrincipal = activeProfile(principalProfile);
  if (!activePrincipal) {
    return { ok: false, error: "errors.unauthorized" };
  }

  let userId = user.id;
  let role = activePrincipal.role;
  const cashierContext = headerStore.get("x-luma-cashier-context")?.trim();
  if (cashierContext) {
    let claims;
    try {
      claims = verifyCashierContextToken(cashierContext, {
        secret: cashierContextSecret(),
        principalId: user.id,
      });
    } catch {
      return { ok: false, error: "errors.serverError" };
    }
    if (!claims) return { ok: false, error: "errors.unauthorized" };
    const [cashierProfile] = await db
      .select({ role: profiles.role, isActive: profiles.isActive })
      .from(profiles)
      .where(eq(profiles.id, claims.cashierId))
      .limit(1);
    if (!cashierProfile?.isActive || cashierProfile.role !== claims.role) {
      return { ok: false, error: "errors.unauthorized" };
    }
    userId = claims.cashierId;
    role = cashierProfile.role;
  }
  if (!roles.includes(role)) {
    return { ok: false, error: "errors.forbidden" };
  }

  return { ok: true, userId, role, principalId: user.id };
}

export const requireMobileSalesAccess = () =>
  requireMobileRole(["owner", "manager", "cashier"]);

export const requireMobileStockAccess = () =>
  requireMobileRole(["owner", "manager", "warehouse"]);

export const requireMobileManager = () =>
  requireMobileRole(["owner", "manager"]);

export const requireMobileOwner = () =>
  requireMobileRole(["owner"]);

export const requireMobileUser = () =>
  requireMobileRole(["owner", "manager", "cashier", "warehouse"]);
