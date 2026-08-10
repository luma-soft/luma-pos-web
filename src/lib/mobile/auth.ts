import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import type { Gate, Role } from "@/lib/actions/common";
import { requireStoreContext } from "@/lib/auth/store-context";
import {
  MANAGER_ROLES,
  OWNER_ROLES,
  SALES_ACCESS_ROLES,
  STAFF_ROLES,
  STOCK_ACCESS_ROLES,
  STOCK_READ_ROLES,
} from "@/lib/auth/roles";
import {
  cashierContextSecret,
  verifyCashierContextToken,
} from "@/lib/auth/cashier-pin";

export type MobileGate = Gate & { principalId?: string };

export async function requireMobileRole(
  roles: readonly Role[],
): Promise<MobileGate> {
  const headerStore = await headers();
  let context;
  try {
    context = await requireStoreContext();
  } catch {
    return { ok: false, error: "errors.unauthorized" };
  }
  let userId = context.userId;
  let role = context.role;
  const cashierContext = headerStore.get("x-luma-cashier-context")?.trim();
  if (cashierContext) {
    let claims;
    try {
      claims = verifyCashierContextToken(cashierContext, {
        secret: cashierContextSecret(),
        principalId: context.userId,
        storeId: context.storeId,
      });
    } catch {
      return { ok: false, error: "errors.serverError" };
    }
    if (!claims) return { ok: false, error: "errors.unauthorized" };
    const [cashierProfile] = await db
      .select({ role: profiles.role, isActive: profiles.isActive })
      .from(profiles)
      .where(and(
        eq(profiles.id, claims.cashierId),
        eq(profiles.storeId, context.storeId),
      ))
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

  return {
    ok: true,
    userId,
    storeId: context.storeId,
    role,
    features: context.features,
    principalId: context.userId,
  };
}

export const requireMobileSalesAccess = () =>
  requireMobileRole(SALES_ACCESS_ROLES);

export const requireMobileStockAccess = () =>
  requireMobileRole(STOCK_ACCESS_ROLES);

export const requireMobileStockReadAccess = () =>
  requireMobileRole(STOCK_READ_ROLES);

export const requireMobileManager = () => requireMobileRole(MANAGER_ROLES);

export const requireMobileOwner = () => requireMobileRole(OWNER_ROLES);

export const requireMobileUser = () => requireMobileRole(STAFF_ROLES);

export const requireMobileServiceAccess = () =>
  requireMobileRole(["owner", "manager", "technician"]);
