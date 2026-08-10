import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import {
  getAuthenticatedUser,
  requireStoreContext,
  resolveStoreContextForUser,
  UnauthorizedError,
} from "@/lib/auth/store-context";
import type { StoreFeatureSet } from "@/lib/tenancy/store-features";
import { storeFeatureEnabled, type StoreFeatureKey } from "@/lib/tenancy/store-features";
import {
  MANAGER_ROLES,
  OWNER_ROLES,
  SALES_ACCESS_ROLES,
  STOCK_ACCESS_ROLES,
  type Role,
} from "@/lib/auth/roles";

export type { Role } from "@/lib/auth/roles";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export { UnauthorizedError } from "@/lib/auth/store-context";

/** Lấy user đang đăng nhập, throw nếu chưa login. */
export async function requireUser() {
  const user = await getAuthenticatedUser();
  if (!user) throw new UnauthorizedError();
  if (!await resolveStoreContextForUser(user.id)) throw new UnauthorizedError();
  return user;
}

/** profiles.id để gắn createdBy — null nếu user chưa có profile row. */
export async function getProfileId(userId: string): Promise<string | null> {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  return p?.id ?? null;
}

/** Vai trò của user (profiles.role). User không có profile active bị từ chối. */
export async function getRole(userId: string): Promise<Role> {
  const context = await resolveStoreContextForUser(userId);
  if (!context) throw new UnauthorizedError();
  return context.role;
}

export type Gate = {
  ok: true;
  userId: string;
  storeId: string;
  role: Role;
  features: StoreFeatureSet;
} | { ok: false; error: string };

/** Cổng RBAC: yêu cầu login + vai trò nằm trong `roles`. Trả userId+role nếu hợp lệ. */
export async function requireRole(roles: Role[]): Promise<Gate> {
  let context;
  try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  if (!roles.includes(context.role)) return { ok: false, error: "errors.forbidden" };
  return {
    ok: true,
    userId: context.userId,
    storeId: context.storeId,
    role: context.role,
    features: context.features,
  };
}

/** Entitlement + RBAC gate. Unknown/disabled features always fail closed. */
export async function requireFeatureRole(feature: StoreFeatureKey, roles: Role[]): Promise<Gate> {
  const gate = await requireRole(roles);
  if (!gate.ok) return gate;
  return storeFeatureEnabled(gate.features, feature)
    ? gate
    : { ok: false, error: "FEATURE_DISABLED" };
}

/** Chủ/Quản lý — nghiệp vụ quản trị (giá, hủy/sửa đơn, hoàn tiền, KM, sổ quỹ...). */
export const requireManager = () => requireRole([...MANAGER_ROLES]);

/** Chỉ Chủ cửa hàng — cấu hình nhạy cảm như AI provider/API key. */
export const requireOwner = () => requireRole([...OWNER_ROLES]);

/** Chủ/Quản lý/Thủ kho — hàng hóa & kho (sản phẩm, nhập hàng, kiểm kho). */
export const requireStockAccess = () => requireRole([...STOCK_ACCESS_ROLES]);

/** Chủ/Quản lý/Thu ngân — bán hàng và thu tiền. */
export const requireSalesAccess = () => requireRole([...SALES_ACCESS_ROLES]);

/** Drizzle bọc lỗi PG vào DrizzleQueryError — lỗi gốc ở e.cause. */
export function pgErrorCode(e: unknown): string | undefined {
  return (e as { cause?: { code?: string } })?.cause?.code
    ?? (e as { code?: string })?.code;
}

export function isUniqueViolation(e: unknown): boolean {
  return pgErrorCode(e) === "23505" || (e instanceof Error && e.message.includes("duplicate key"));
}

/** Mã chứng từ: DH-250607-1432XX */
export function generateCode(prefix: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `${prefix}-${date}-${time}${rand}`;
}

export const toMoney = (n: number) => n.toFixed(2);
export const toQty = (n: number) => n.toFixed(4);
