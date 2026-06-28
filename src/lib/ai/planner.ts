import { z } from "zod";
import { completeAiText, loadAiProviderConfig, parseJsonText } from "@/lib/ai/provider-adapter";
import type { AiTokenUsage } from "@/lib/ai/usage";
import { normalizeSearch } from "@/lib/normalize";

export type AiPlannerIntent =
  | "create_draft_purchase_order_from_restocking"
  | "create_draft_purchase_order"
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
  entities: Record<string, unknown>;
  missingFields: string[];
  ambiguousEntities: {
    type: string;
    query: string;
    candidates: { id?: string; label: string; code?: string; confidence?: number }[];
  }[];
  warnings: string[];
  suggestedNextQuestion: string;
};

export type AiPlannerResponse =
  | { ok: true; plan: AiPlannerResult; tokenUsage?: AiTokenUsage }
  | { ok: false; reason: string };

const INTENTS = [
  "create_draft_purchase_order_from_restocking",
  "create_draft_purchase_order",
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
] as const satisfies readonly AiPlannerIntent[];

const plannerEntitySchema = z.record(z.string(), z.unknown()).default({});
const ambiguousEntitySchema = z.object({
  type: z.string().max(80),
  query: z.string().max(200).default(""),
  candidates: z.array(z.object({
    id: z.string().max(120).optional(),
    label: z.string().max(200),
    code: z.string().max(120).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).max(8).default([]),
});

export const aiPlannerResultSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  canonicalPrompt: z.string().trim().min(1).max(600),
  entities: plannerEntitySchema,
  missingFields: z.array(z.string().max(80)).max(10).default([]),
  ambiguousEntities: z.array(ambiguousEntitySchema).max(8).default([]),
  warnings: z.array(z.string().max(240)).max(10).default([]),
  suggestedNextQuestion: z.string().max(300).default(""),
});

function normalizePlan(raw: unknown, fallbackPrompt: string): AiPlannerResult | null {
  const parsed = aiPlannerResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    canonicalPrompt: parsed.data.canonicalPrompt || fallbackPrompt,
  };
}

export function heuristicAiPlannerIntent(input: {
  prompt: string;
  hasAttachments?: boolean;
}): AiPlannerResult | null {
  const prompt = input.prompt.trim();
  const normalized = normalizeSearch(prompt);
  const words = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  const hasAiAttachment = normalized.includes("ai attachment parse");
  const hasPos = normalized.includes("pos") || normalized.includes("gio pos") || normalized.includes("gio hang");
  const missingFields: string[] = [];
  let intent: AiPlannerIntent = "unknown";

  if ((normalized.includes("po") || normalized.includes("phieu nhap")) && normalized.includes("sap het")) {
    intent = "create_draft_purchase_order_from_restocking";
  } else if (
    normalized.includes("dat hang nhap") ||
    normalized.includes("don dat hang nhap") ||
    (normalized.includes("dat hang") && (normalized.includes("ncc") || normalized.includes("nha cung cap")))
  ) {
    intent = "create_draft_purchase_order";
  } else if (
    normalized.includes("huy hoa don") ||
    normalized.includes("huy don") ||
    normalized.includes("hoa don dien tu") ||
    normalized.includes("e-invoice") ||
    normalized.includes("einvoice") ||
    normalized.includes("hoan tien") ||
    normalized.includes("tra hang")
  ) {
    intent = "order_action";
  } else if (hasAiAttachment || input.hasAttachments || normalized.includes("ocr") || words.has("anh")) {
    intent = "pos_image_cart_draft";
  } else if (hasPos) {
    intent = "pos_voice_cart_draft";
  } else if (normalized.includes("tang") && normalized.includes("bang gia") && normalized.includes("%")) {
    intent = "apply_price_formula";
  } else if (normalized.includes("dat gia") || normalized.includes("gia ban")) {
    intent = "set_product_price";
    if (normalized.includes("san pham nay")) missingFields.push("product");
  } else if (normalized.includes("nhap") && normalized.includes("kho")) {
    intent = "create_inventory_inbound";
  }

  if (intent === "unknown") return null;
  return {
    intent,
    confidence: 0.9,
    canonicalPrompt: prompt,
    entities: {},
    missingFields,
    ambiguousEntities: [],
    warnings: [],
    suggestedNextQuestion: "",
  };
}

export async function planAiAssistantIntent(input: {
  prompt: string;
  hasAttachments?: boolean;
}): Promise<AiPlannerResponse> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, reason: "empty_prompt" };
  const heuristicPlan = heuristicAiPlannerIntent({ prompt, hasAttachments: input.hasAttachments });
  if (heuristicPlan) return { ok: true, plan: heuristicPlan };
  const config = await loadAiProviderConfig();
  if (!config.apiKey) return { ok: false, reason: "missing_api_key" };
  if (!config.capabilities.textPlanning) return { ok: false, reason: `unsupported_provider:${config.provider}` };

  const messages = [
    {
      role: "system" as const,
      text:
        "You are an intent planner for a Vietnamese POS app. " +
        "Classify the user command into one supported intent and rewrite it into a concise canonical Vietnamese command. " +
        "Never execute business actions. Never invent entity IDs. Return JSON only.",
    },
    {
      role: "user" as const,
      text:
        `Supported intents: ${INTENTS.join(", ")}.\n` +
        "Intent guide:\n" +
        "- create_draft_purchase_order_from_restocking: create draft PO from AI restocking suggestions.\n" +
        "- create_draft_purchase_order: create a draft supplier purchase order/PO from user-provided item list; do not receive stock.\n" +
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
        "Return compact JSON exactly matching this schema:\n" +
        "{ intent:string, confidence:number 0..1, canonicalPrompt:string, entities:object, missingFields:string[], ambiguousEntities:[{type:string,query:string,candidates:[{id?:string,label:string,code?:string,confidence?:number}]}], warnings:string[], suggestedNextQuestion:string }.\n" +
        "Use missingFields for critical info the app must ask before preview. Use ambiguousEntities when the user named an entity but it needs selection. " +
        "If unsure, use intent unknown and low confidence. Do not guess product/customer/supplier IDs.\n" +
        `Has attachments: ${input.hasAttachments ? "yes" : "no"}.\n` +
        `Configured provider: ${config.provider}; model: ${config.textModel}.\n` +
        `User command: ${prompt}`,
    },
  ];

  try {
    const completion = await completeAiText({ config, messages, jsonOnly: true });
    const parsed = parseJsonText(completion.text);
    const plan = normalizePlan(parsed, prompt);
    if (!plan) return { ok: false, reason: "invalid_planner_json" };
    return { ok: true, plan, tokenUsage: completion.tokenUsage };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "planner_request_failed" };
  }
}
