import { and, eq, sql } from "drizzle-orm";
import { storeSettings } from "@/db/schema";
import {
  mergeMobileNotificationSettings,
} from "@/lib/settings/mobile-settings-access";
import {
  parseStorePrefs,
  type MobileNotificationSettingsPatch,
  type StorePrefs,
  type StorePrefsPatch,
} from "@/lib/schemas/settings";

// Drizzle's PostgreSQL and PGlite adapters share this fluent surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseLike = any;

export async function persistStorePrefsMutation<T>(
  database: DatabaseLike,
  mutate: (current: StorePrefs) => {
    next: StorePrefs;
    value: T;
  },
): Promise<{ before: StorePrefs; after: StorePrefs; value: T }> {
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
    const mutation = mutate(current);
    const nextUpdatedAt = new Date(Math.max(
      Date.now(),
      row.updatedAt.getTime() + 1,
    ));
    const [updated] = await database
      .update(storeSettings)
      .set({
        prefs: mutation.next,
        updatedAt: nextUpdatedAt,
      })
      .where(and(
        eq(storeSettings.id, "default"),
        sql`"store_settings"."xmin"::text = ${row.version}`,
      ))
      .returning({ id: storeSettings.id });
    if (updated) {
      return {
        before: current,
        after: mutation.next,
        value: mutation.value,
      };
    }
  }

  throw new Error("STORE_SETTINGS_CONFLICT");
}

export async function persistStorePrefsPatch(
  database: DatabaseLike,
  patch: StorePrefsPatch,
): Promise<StorePrefs> {
  const persisted = await persistStorePrefsMutation(database, (current) => {
    const next = { ...current, ...patch };
    return { next, value: next };
  });
  return persisted.value;
}

export async function persistNotificationSettingsPatch(
  database: DatabaseLike,
  patch: MobileNotificationSettingsPatch,
): Promise<StorePrefs["notifications"]> {
  const persisted = await persistStorePrefsMutation(database, (current) => {
    const notifications = mergeMobileNotificationSettings(
      current.notifications,
      patch,
    );
    return {
      next: { ...current, notifications },
      value: notifications,
    };
  });
  return persisted.value;
}
