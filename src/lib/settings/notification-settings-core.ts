import { and, eq, sql } from "drizzle-orm";
import { storeSettings } from "@/db/schema";
import {
  mergeMobileNotificationSettings,
} from "@/lib/settings/mobile-settings-access";
import {
  parseStorePrefs,
  type MobileNotificationSettingsPatch,
  type StorePrefs,
} from "@/lib/schemas/settings";

// Drizzle's PostgreSQL and PGlite adapters share this fluent surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseLike = any;

export async function persistNotificationSettingsPatch(
  database: DatabaseLike,
  patch: MobileNotificationSettingsPatch,
): Promise<StorePrefs["notifications"]> {
  await database
    .insert(storeSettings)
    .values({ id: "default" })
    .onConflictDoNothing({ target: storeSettings.id });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [row] = await database
      .select({
        prefs: storeSettings.prefs,
        updatedAt: storeSettings.updatedAt,
        version: sql<string>`"store_settings"."xmin"::text`,
      })
      .from(storeSettings)
      .where(eq(storeSettings.id, "default"))
      .limit(1);
    if (!row) throw new Error("STORE_SETTINGS_NOT_FOUND");

    const current = parseStorePrefs(row.prefs);
    const notifications = mergeMobileNotificationSettings(
      current.notifications,
      patch,
    );
    const nextUpdatedAt = new Date(Math.max(
      Date.now(),
      row.updatedAt.getTime() + 1,
    ));
    const [updated] = await database
      .update(storeSettings)
      .set({
        prefs: { ...current, notifications },
        updatedAt: nextUpdatedAt,
      })
      .where(and(
        eq(storeSettings.id, "default"),
        sql`"store_settings"."xmin"::text = ${row.version}`,
      ))
      .returning({ id: storeSettings.id });
    if (updated) return notifications;
  }

  throw new Error("STORE_SETTINGS_CONFLICT");
}
