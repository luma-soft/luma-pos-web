"use server";

import { revalidateAppData as revalidatePath } from "@/lib/sync/revalidate-app-data";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { storeSettings } from "@/db/schema";
import { storeSettingsSchema, type StoreSettingsInput } from "@/lib/schemas/settings";
import { type ActionResult } from "./common";
import { requireStoreContext } from "@/lib/auth/store-context";
import { recordActivity } from "@/lib/audit/activity-log";

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
      const changedFields = (Object.keys(v) as Array<keyof typeof v>).filter((key) => current?.[key] !== v[key]);
      if (current?.onboarded && !changedFields.length) return;
      await tx.insert(storeSettings)
        .values({ storeId: context.storeId, id: "default", ...v, onboarded: true })
        .onConflictDoUpdate({ target: storeSettings.storeId, set: { ...v, onboarded: true, updatedAt: sql`now()` } });
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
