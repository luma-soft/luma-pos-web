import { getAiProviderSettings } from "@/lib/data/settings";
import type { AiTokenUsage } from "@/lib/ai/usage";

export type AiPlannerIntent =
  | "create_draft_purchase_order_from_restocking"
  | "create_inventory_inbound"
  | "set_product_price"
  | "apply_price_formula"
  | "product_command"
  | "customer_action"
  | "cashbook_action"
  | "order_action"
  | "pos_voice_cart_draft"
  | "pos_image_cart_draft"
  | "report_summary"
  | "unknown";

export type AiPlannerResult = {
  intent: AiPlannerIntent;
  canonicalPrompt: string;
  confidence: number;
  missingFields: string[];
  warnings: string[];
};

export type AiPlannerResponse =
  | { ok: true; plan: AiPlannerResult; tokenUsage?: AiTokenUsage }
  | { ok: false; reason: string };

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const INTENTS: AiPlannerIntent[] = [
  "create_draft_purchase_order_from_restocking",
  "create_inventory_inbound",
  "set_product_price",
  "apply_price_formula",
  "product_command",
  "customer_action",
  "cashbook_action",
  "order_action",
  "pos_voice_cart_draft",
  "pos_image_cart_draft",
  "report_summary",
  "unknown",
];

function outputText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const root = response as { output_text?: unknown; output?: unknown };
  if (typeof root.output_text === "string") return root.output_text;
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

function parseJsonText(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function tokenUsageFromResponse(raw: unknown, model: string): AiTokenUsage | undefined {
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

function normalizePlan(raw: unknown, fallbackPrompt: string): AiPlannerResult | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const intent = typeof root.intent === "string" && INTENTS.includes(root.intent as AiPlannerIntent)
    ? root.intent as AiPlannerIntent
    : "unknown";
  const confidence = Math.max(0, Math.min(1, Number(root.confidence)));
  return {
    intent,
    canonicalPrompt: typeof root.canonicalPrompt === "string" && root.canonicalPrompt.trim()
      ? root.canonicalPrompt.trim()
      : fallbackPrompt,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    missingFields: Array.isArray(root.missingFields) ? root.missingFields.map(String).slice(0, 8) : [],
    warnings: Array.isArray(root.warnings) ? root.warnings.map(String).slice(0, 8) : [],
  };
}

export async function planAiAssistantIntent(input: {
  prompt: string;
  hasAttachments?: boolean;
}): Promise<AiPlannerResponse> {
  const ai = await getAiProviderSettings();
  const apiKey = ai.openaiApiKey || process.env.OPENAI_API_KEY || "";
  const provider = process.env.AI_ATTACHMENT_PROVIDER || "openai";
  const model = ai.openaiVisionModel || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, reason: "empty_prompt" };
  if (provider !== "openai") return { ok: false, reason: `unsupported_provider:${provider}` };
  if (!apiKey) return { ok: false, reason: "missing_api_key" };

  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are an intent planner for a Vietnamese POS app. " +
              "Classify the user command into one supported intent and rewrite it into a concise canonical Vietnamese command. " +
              "Never execute business actions. Never invent entity IDs. Return JSON only.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Supported intents: ${INTENTS.join(", ")}.\n` +
              "Intent guide:\n" +
              "- create_draft_purchase_order_from_restocking: create draft PO from AI restocking suggestions.\n" +
              "- create_inventory_inbound: receive/import stock or create purchase/inbound record.\n" +
              "- set_product_price: set one product price.\n" +
              "- apply_price_formula: bulk price formula or percentage changes.\n" +
              "- product_command: create/update product, category, brand, min stock.\n" +
              "- customer_action: create/update customer.\n" +
              "- cashbook_action: cashbook income/expense.\n" +
              "- order_action: create order/invoice/quote, payment, convert quote.\n" +
              "- pos_voice_cart_draft: POS cart from voice/transcript.\n" +
              "- pos_image_cart_draft: POS cart from image/OCR/menu/order photo.\n" +
              "- report_summary: asks about sales, revenue, best sellers, stock status.\n" +
              "Return compact JSON with keys: intent, canonicalPrompt, confidence, missingFields, warnings.\n" +
              `Has attachments: ${input.hasAttachments ? "yes" : "no"}.\n` +
              `User command: ${prompt}`,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, reason: json?.error?.message ?? `http.${response.status}` };
    const parsed = parseJsonText(outputText(json));
    const plan = normalizePlan(parsed, prompt);
    if (!plan) return { ok: false, reason: "invalid_planner_json" };
    return { ok: true, plan, tokenUsage: tokenUsageFromResponse(json, model) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "planner_request_failed" };
  }
}
