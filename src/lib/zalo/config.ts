import { getZaloSettings } from "@/lib/data/settings";

export type ZaloConfig = Awaited<ReturnType<typeof getZaloConfig>>;

export async function getZaloConfig() {
  const settings = await getZaloSettings();
  const configured = Boolean(settings.enabled && settings.accessToken && (settings.portalTemplateId || settings.invoiceTemplateId || settings.debtTemplateId));
  return {
    ...settings,
    configured,
  };
}

export function publicZaloStatus(config: Awaited<ReturnType<typeof getZaloConfig>>) {
  return {
    enabled: config.enabled,
    configured: config.configured,
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
