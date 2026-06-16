import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, storeSettings } from "@/db/schema";
import { parseStorePrefs, type StorePrefs } from "@/lib/schemas/settings";

export type StoreSettings = {
  name: string; address: string; phone: string; taxCode: string;
  industry: string; currency: string; locale: string; onboarded: boolean;
  prefs: StorePrefs;
};

const DEFAULTS: StoreSettings = {
  name: "", address: "", phone: "", taxCode: "", industry: "grocery", currency: "VND", locale: "vi-VN", onboarded: false,
  prefs: parseStorePrefs({}),
};

/** Cấu hình cửa hàng (1 dòng id='default'). Trả mặc định nếu chưa có. */
export async function getStoreSettings(): Promise<StoreSettings> {
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.id, "default")).limit(1);
  if (!row) return DEFAULTS;
  return {
    name: row.name, address: row.address, phone: row.phone, taxCode: row.taxCode,
    industry: row.industry, currency: row.currency, locale: row.locale, onboarded: row.onboarded,
    prefs: parseStorePrefs(row.prefs),
  };
}

/** Danh sách nhân viên (profiles). */
export async function getStaff() {
  return db
    .select({ id: profiles.id, fullName: profiles.fullName, phone: profiles.phone, role: profiles.role, isActive: profiles.isActive, createdAt: profiles.createdAt })
    .from(profiles)
    .orderBy(asc(profiles.fullName));
}
export type StaffRow = Awaited<ReturnType<typeof getStaff>>[number];
