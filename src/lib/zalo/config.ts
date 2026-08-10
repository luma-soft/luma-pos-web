import { getZaloSettings } from "@/lib/data/settings";
import { db } from "@/db";
import { storeSettings, stores } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { parseStorePrefs } from "@/lib/schemas/settings";

export type ZaloConfig = Awaited<ReturnType<typeof getZaloConfig>>;

export async function getZaloConfig(storeId: string) {
  const settings = await getZaloSettings(storeId);
  const connected = Boolean(settings.enabled && settings.oaId && settings.appId && settings.accessToken);
  const znsReady = Boolean(connected && (settings.portalTemplateId || settings.invoiceTemplateId || settings.debtTemplateId));
  const oaReady = Boolean(connected);
  return {
    ...settings,
    connected,
    configured: znsReady,
    oaReady,
    znsReady,
  };
}

export async function resolveZaloWebhookStore(input: { appId?: string | null; oaId?: string | null }) {
  const appId = input.appId?.trim();
  const oaId = input.oaId?.trim();
  if (!appId && !oaId) return null;
  const rows = await db.select({ storeId: storeSettings.storeId, prefs: storeSettings.prefs })
    .from(storeSettings)
    .innerJoin(stores, and(eq(stores.id, storeSettings.storeId), eq(stores.status, "active")))
    .where(sql`(${storeSettings.prefs}->'zalo'->>'appId' = ${appId ?? ""} or ${storeSettings.prefs}->'zalo'->>'oaId' = ${oaId ?? ""})`)
    .limit(2);
  const matched = rows.filter((row) => {
    const zalo = parseStorePrefs(row.prefs).zalo;
    return Boolean((appId && zalo.appId === appId) || (oaId && zalo.oaId === oaId));
  });
  return matched.length === 1 ? matched[0].storeId : null;
}

export function publicZaloStatus(config: Awaited<ReturnType<typeof getZaloConfig>>) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    connected: config.connected,
    oaReady: config.oaReady,
    znsReady: config.znsReady,
    deliveryMode: config.deliveryMode,
    oaId: config.oaId,
    appId: config.appId,
    appSecretSet: Boolean(config.appSecret),
    accessTokenSet: Boolean(config.accessToken),
    refreshTokenSet: Boolean(config.refreshToken),
    webhookSecretSet: Boolean(config.webhookSecret),
    portalTemplateId: config.portalTemplateId,
    invoiceTemplateId: config.invoiceTemplateId,
    debtTemplateId: config.debtTemplateId,
  };
}
