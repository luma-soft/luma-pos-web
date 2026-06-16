"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, storeSettings } from "@/db/schema";
import { storeSettingsSchema, storePrefsPatchSchema, parseStorePrefs, STAFF_ROLES, type StoreSettingsInput, type StaffRole, type StorePrefsPatch } from "@/lib/schemas/settings";
import { type ActionResult, requireUser, getRole } from "./common";
import { Routes } from "@/lib/routes";

async function requireManager(): Promise<{ ok: true } | { ok: false; error: string }> {
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return { ok: false, error: "errors.unauthorized" }; }
  const role = await getRole(userId);
  if (role !== "owner" && role !== "manager") return { ok: false, error: "errors.forbidden" };
  return { ok: true };
}

export async function updateStoreSettings(input: StoreSettingsInput): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.insert(storeSettings)
      .values({ id: "default", ...v })
      .onConflictDoUpdate({ target: storeSettings.id, set: { ...v, updatedAt: sql`now()` } });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateStoreSettings failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

/** Cập nhật từng phần prefs (Thuế/Thanh toán/Thông báo/Phần cứng) — merge top-level. */
export async function updateStorePrefs(patch: StorePrefsPatch): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  const parsed = storePrefsPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  try {
    const [row] = await db.select({ prefs: storeSettings.prefs }).from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
    const current = parseStorePrefs(row?.prefs);
    const next = { ...current, ...parsed.data };
    await db.insert(storeSettings)
      .values({ id: "default", prefs: next })
      .onConflictDoUpdate({ target: storeSettings.id, set: { prefs: next, updatedAt: sql`now()` } });
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateStorePrefs failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function updateStaffRole(id: string, role: StaffRole): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  if (!STAFF_ROLES.includes(role)) return { ok: false, error: "errors.invalidData" };
  try {
    await db.update(profiles).set({ role }).where(eq(profiles.id, id));
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("updateStaffRole failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}

export async function setStaffActive(id: string, active: boolean): Promise<ActionResult> {
  const gate = await requireManager();
  if (!gate.ok) return gate;
  try {
    await db.update(profiles).set({ isActive: active }).where(eq(profiles.id, id));
    revalidatePath(Routes.Settings);
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("setStaffActive failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
