import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export class UnauthorizedError extends Error {
  constructor() { super("UNAUTHORIZED"); }
}

/** Lấy user đang đăng nhập, throw nếu chưa login. */
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** profiles.id để gắn createdBy — null nếu user chưa có profile row. */
export async function getProfileId(userId: string): Promise<string | null> {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  return p?.id ?? null;
}

/** Vai trò của user (profiles.role) — mặc định 'cashier' nếu chưa có profile. */
export async function getRole(userId: string): Promise<string> {
  const [p] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  return p?.role ?? "cashier";
}

export type Role = "owner" | "manager" | "cashier" | "warehouse";
export type Gate = { ok: true; userId: string; role: Role } | { ok: false; error: string };

/** Cổng RBAC: yêu cầu login + vai trò nằm trong `roles`. Trả userId+role nếu hợp lệ. */
export async function requireRole(roles: Role[]): Promise<Gate> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  const role = (await getRole(userId)) as Role;
  if (!roles.includes(role)) return { ok: false, error: "errors.forbidden" };
  return { ok: true, userId, role };
}

/** Chủ/Quản lý — nghiệp vụ quản trị (giá, hủy/sửa đơn, hoàn tiền, KM, sổ quỹ...). */
export const requireManager = () => requireRole(["owner", "manager"]);

/** Chủ/Quản lý/Thủ kho — hàng hóa & kho (sản phẩm, nhập hàng, kiểm kho). */
export const requireStockAccess = () => requireRole(["owner", "manager", "warehouse"]);

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
