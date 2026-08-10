"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { storeSettings } from "@/db/schema";
import { storeSettingsSchema, type StoreSettingsInput } from "@/lib/schemas/settings";
import { type ActionResult } from "./common";
import { requireStoreContext } from "@/lib/auth/store-context";

/** Hoàn tất thiết lập ban đầu — lưu thông tin cửa hàng + đánh dấu onboarded. */
export async function completeOnboarding(input: StoreSettingsInput): Promise<ActionResult> {
  let context;
  try { context = await requireStoreContext(); } catch { return { ok: false, error: "errors.unauthorized" }; }
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "errors.invalidData" };
  const v = parsed.data;
  try {
    await db.insert(storeSettings)
      .values({ storeId: context.storeId, id: "default", ...v, onboarded: true })
      .onConflictDoUpdate({ target: storeSettings.storeId, set: { ...v, onboarded: true, updatedAt: sql`now()` } });
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    console.error("completeOnboarding failed:", e);
    return { ok: false, error: "errors.serverError" };
  }
}
