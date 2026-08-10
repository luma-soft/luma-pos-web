import { loadAiProviderConfig } from "@/lib/ai/provider-adapter";
import { mobileError } from "@/lib/mobile/response";

export const AI_NOT_CONFIGURED_ERROR = "ai.provider.not_configured";

export async function isAiProviderConfigured(storeId: string) {
  const config = await loadAiProviderConfig(storeId);
  return Boolean(config.apiKey);
}

export async function requireAiProviderConfigured(storeId: string) {
  return (await isAiProviderConfigured(storeId))
    ? null
    : mobileError(AI_NOT_CONFIGURED_ERROR, 404);
}
