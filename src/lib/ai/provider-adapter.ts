import { getAiProviderSettings } from "@/lib/data/settings";
import { CURRENT_STORE_ID } from "@/lib/tenancy/constants";
import type { AiTokenUsage } from "@/lib/ai/usage";
import { AI_PROVIDERS, type StorePrefs } from "@/lib/schemas/settings";

export type AiProviderId = (typeof AI_PROVIDERS)[number];

export type AiProviderCapabilities = {
  textPlanning: boolean;
  visionOcr: boolean;
  structuredJson: boolean;
  tokenUsage: boolean;
  estimatedCost: boolean;
};

export type AiProviderConfig = {
  provider: AiProviderId;
  apiKey: string;
  textModel: string;
  visionModel: string;
  baseUrl: string;
  capabilities: AiProviderCapabilities;
};

export type AiModelMessage = {
  role: "system" | "user" | "assistant";
  text: string;
};

export type AiTextCompletionInput = {
  config: AiProviderConfig;
  messages: AiModelMessage[];
  jsonOnly?: boolean;
};

export type AiVisionCompletionInput = {
  config: AiProviderConfig;
  prompt: string;
  imageDataUrl: string;
};

export type AiModelResponse = {
  text: string;
  raw: unknown;
  tokenUsage?: AiTokenUsage;
};

const PROVIDER_DEFAULTS: Record<AiProviderId, {
  baseUrl: string;
  textModel: string;
  visionModel: string;
  capabilities: AiProviderCapabilities;
}> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    textModel: "gpt-4.1-mini",
    visionModel: "gpt-4.1-mini",
    capabilities: { textPlanning: true, visionOcr: true, structuredJson: true, tokenUsage: true, estimatedCost: true },
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    textModel: "deepseek-chat",
    visionModel: "",
    capabilities: { textPlanning: true, visionOcr: false, structuredJson: true, tokenUsage: true, estimatedCost: true },
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    textModel: "gemini-2.5-flash",
    visionModel: "gemini-2.5-flash",
    capabilities: { textPlanning: true, visionOcr: true, structuredJson: true, tokenUsage: true, estimatedCost: true },
  },
};

function coerceProvider(value: unknown): AiProviderId {
  return typeof value === "string" && AI_PROVIDERS.includes(value as AiProviderId)
    ? value as AiProviderId
    : "gemini";
}

function providerApiKey(prefs: StorePrefs["ai"]) {
  return prefs.openaiApiKey || "";
}

function providerBaseUrl(provider: AiProviderId) {
  return PROVIDER_DEFAULTS[provider].baseUrl;
}

export function buildAiProviderConfig(prefs: StorePrefs["ai"]): AiProviderConfig {
  const provider = coerceProvider(prefs.provider);
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    apiKey: providerApiKey(prefs),
    textModel: prefs.textModel || defaults.textModel,
    visionModel: prefs.visionModel || prefs.openaiVisionModel || defaults.visionModel,
    baseUrl: providerBaseUrl(provider).replace(/\/$/, ""),
    capabilities: defaults.capabilities,
  };
}

export async function loadAiProviderConfig(storeId = CURRENT_STORE_ID): Promise<AiProviderConfig> {
  const prefs = await getAiProviderSettings(storeId);
  return buildAiProviderConfig(prefs);
}

export function outputText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const root = response as { output_text?: unknown; output?: unknown; choices?: unknown };
  if (typeof root.output_text === "string") return root.output_text;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choiceText = choices
    .map((choice) => {
      if (!choice || typeof choice !== "object") return "";
      const message = (choice as { message?: unknown }).message;
      if (message && typeof message === "object" && "content" in message) {
        return String((message as { content?: unknown }).content ?? "");
      }
      return String((choice as { text?: unknown }).text ?? "");
    })
    .filter(Boolean)
    .join("\n");
  if (choiceText) return choiceText;
  const output = Array.isArray(root.output) ? root.output : [];
  return output
    .flatMap((item) => {
      const content = item && typeof item === "object" && "content" in item
        ? (item as { content?: unknown }).content
        : [];
      return Array.isArray(content) ? content : [];
    })
    .map((item) => item && typeof item === "object" && "text" in item ? String((item as { text?: unknown }).text ?? "") : "")
    .filter(Boolean)
    .join("\n");
}

export function tokenUsageFromResponse(raw: unknown, model: string): AiTokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = (raw as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const root = usage as Record<string, unknown>;
  const inputTokens = Number(root.input_tokens ?? root.prompt_tokens ?? 0);
  const outputTokens = Number(root.output_tokens ?? root.completion_tokens ?? 0);
  const totalTokens = Number(root.total_tokens ?? inputTokens + outputTokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens) && !Number.isFinite(totalTokens)) return undefined;
  return {
    model,
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  };
}

export function parseJsonText(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as unknown;
    } catch {
      return null;
    }
  }
}

export async function completeAiText(input: AiTextCompletionInput): Promise<AiModelResponse> {
  const { config } = input;
  if (!config.apiKey) throw new Error("missing_api_key");
  if (!config.capabilities.textPlanning) throw new Error(`unsupported_text_planning:${config.provider}`);

  if (config.provider === "openai") {
    const response = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.textModel,
        input: input.messages.map((message) => ({
          role: message.role,
          content: [{ type: "input_text", text: message.text }],
        })),
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error?.message ?? `http.${response.status}`);
    return { text: outputText(json), raw: json, tokenUsage: tokenUsageFromResponse(json, config.textModel) };
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.textModel,
      messages: input.messages.map((message) => ({ role: message.role, content: message.text })),
      response_format: input.jsonOnly ? { type: "json_object" } : undefined,
    }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? `http.${response.status}`);
  return { text: outputText(json), raw: json, tokenUsage: tokenUsageFromResponse(json, config.textModel) };
}

export async function completeAiVision(input: AiVisionCompletionInput): Promise<AiModelResponse> {
  const { config } = input;
  if (!config.apiKey) throw new Error("missing_api_key");
  if (!config.capabilities.visionOcr) throw new Error(`unsupported_vision:${config.provider}`);

  if (config.provider === "openai") {
    const response = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.visionModel,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: input.prompt },
            { type: "input_image", image_url: input.imageDataUrl, detail: "high" },
          ],
        }],
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error?.message ?? `http.${response.status}`);
    return { text: outputText(json), raw: json, tokenUsage: tokenUsageFromResponse(json, config.visionModel) };
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.visionModel,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          { type: "image_url", image_url: { url: input.imageDataUrl } },
        ],
      }],
      response_format: { type: "json_object" },
    }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? `http.${response.status}`);
  return { text: outputText(json), raw: json, tokenUsage: tokenUsageFromResponse(json, config.visionModel) };
}
