"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { storeSettings } from "@/db/schema";
import { storeSettingsSchema, type StoreSettingsInput } from "@/lib/schemas/settings";
import { type ActionResult } from "./common";
import { requireStoreContext } from "@/lib/auth/store-context";
import { recordActivity } from "@/lib/audit/activity-log";
import { formatStoreAddress } from "@/lib/addresses/vietnam";

/** Hoàn tất thiết lập ban đầu — lưu thông tin cửa hàng + đánh dấu onboarded. */
export async function completeOnboarding(input: StoreSettingsInput): Promise<ActionResult> {
  let context;
  try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(storeSettings).where(eq(storeSettings.storeId, context.storeId)).limit(1).for("update");
      const hasStructuredAddress = typeof input === "object" && input !== null &&
        ("addressLine" in input || "addressProvinceCode" in input || "addressWardCode" in input);
      const addressLine = hasStructuredAddress
        ? v.addressLine?.trim() ?? ""
        : current && v.address.trim() === current.address
          ? current.addressLine || v.address.trim()
          : v.address.trim();
      const addressProvinceCode = hasStructuredAddress
        ? v.addressProvinceCode?.trim() ?? ""
        : current && v.address.trim() === current.address
          ? current.addressProvinceCode
          : "";
      const addressWardCode = hasStructuredAddress
        ? v.addressWardCode?.trim() ?? ""
        : current && v.address.trim() === current.address
          ? current.addressWardCode
          : "";
      const address = formatStoreAddress(addressLine, addressProvinceCode, addressWardCode) || addressLine;
      const values = {
        name: v.name,
        address,
        addressLine,
        addressProvinceCode,
        addressWardCode,
        phone: v.phone,
        taxCode: v.taxCode,
        industry: v.industry,
        currency: v.currency,
        locale: v.locale,
      };
      const changedFields = (Object.keys(values) as Array<keyof typeof values>).filter((key) => current?.[key] !== values[key]);
      if (current?.onboarded && !changedFields.length) return;
      await tx.insert(storeSettings)
        .values({ storeId: context.storeId, id: "default", ...values, onboarded: true })
        .onConflictDoUpdate({ target: storeSettings.storeId, set: { ...values, onboarded: true, updatedAt: sql`now()` } });
      await recordActivity(tx, {
        storeId: context.storeId, actorId: context.userId, action: "settings.onboarding.completed", entityType: "store_settings", entityId: context.storeId,
        before: current ? { name: current.name, onboarded: current.onboarded } : null,
        after: { name: v.name, onboarded: true }, metadata: { changedFields },
      });
    });
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("completeOnboarding failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
