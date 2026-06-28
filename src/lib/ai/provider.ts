import type { AiTokenUsage } from "@/lib/ai/usage";
import { completeAiVision, loadAiProviderConfig, parseJsonText, outputText } from "@/lib/ai/provider-adapter";

export type AiAttachmentCandidate = {
  text: string;
  sku?: string | null;
  unitName?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  grossUnitCost?: number | null;
  discount?: number | null;
  discountRate?: number | null;
  lineTotal?: number | null;
  confidence: number;
};

export type AiAttachmentParseResult = {
  provider: "none" | "openai" | "deepseek" | "gemini";
  status: "succeeded" | "unavailable" | "failed";
  documentType?: "sales_receipt" | "purchase_invoice" | "handwritten_order" | "menu_note" | "product_shelf" | "unknown";
  header?: Record<string, unknown> | null;
  extractedText: string;
  candidates: AiAttachmentCandidate[];
  confidence: number;
  unresolvedItems: string[];
  warnings: string[];
  tokenUsage?: AiTokenUsage;
  raw?: unknown;
};

export type AiAttachmentProviderInput = {
  name: string;
  mimeType: string;
  bytes: Buffer;
  prompt?: string;
};

function fallbackResult(reason: string): AiAttachmentParseResult {
  return {
    provider: "none",
    status: "unavailable",
    extractedText: "",
    candidates: [],
    confidence: 0,
    unresolvedItems: [],
    warnings: [reason],
  };
}

function optionalNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeProviderResult(raw: unknown, provider: AiAttachmentParseResult["provider"], text: string, tokenUsage?: AiTokenUsage): AiAttachmentParseResult {
  const parsed = parseJsonText(text);
  if (!parsed) {
    return {
      provider,
      status: "succeeded",
      documentType: "unknown",
      header: null,
      extractedText: text,
      candidates: [],
      confidence: text ? 0.5 : 0,
      unresolvedItems: [],
      warnings: text ? [] : ["Provider returned an empty response."],
      tokenUsage,
      raw,
    };
  }
  const root = parsed as Partial<AiAttachmentParseResult>;
  return {
    provider,
    status: "succeeded",
    documentType: typeof root.documentType === "string" ? root.documentType as AiAttachmentParseResult["documentType"] : "unknown",
    header: root.header && typeof root.header === "object" ? root.header as Record<string, unknown> : null,
    extractedText: typeof root.extractedText === "string" ? root.extractedText : text,
    candidates: Array.isArray(root.candidates)
      ? root.candidates.map((candidate) => ({
          text: String((candidate as { text?: unknown }).text ?? ""),
          sku: typeof (candidate as { sku?: unknown }).sku === "string" ? String((candidate as { sku?: unknown }).sku).trim() : null,
          unitName: typeof (candidate as { unitName?: unknown }).unitName === "string" ? String((candidate as { unitName?: unknown }).unitName).trim() : null,
          quantity: Number.isFinite(Number((candidate as { quantity?: unknown }).quantity))
            ? Number((candidate as { quantity?: unknown }).quantity)
            : null,
          unitCost: optionalNumber((candidate as { unitCost?: unknown }).unitCost),
          grossUnitCost: optionalNumber((candidate as { grossUnitCost?: unknown }).grossUnitCost),
          discount: optionalNumber((candidate as { discount?: unknown }).discount),
          discountRate: optionalNumber((candidate as { discountRate?: unknown }).discountRate),
          lineTotal: optionalNumber((candidate as { lineTotal?: unknown }).lineTotal),
          confidence: Number.isFinite(Number((candidate as { confidence?: unknown }).confidence))
            ? Number((candidate as { confidence?: unknown }).confidence)
            : 0.5,
        })).filter((candidate) => candidate.text)
      : [],
    confidence: Number.isFinite(Number(root.confidence)) ? Number(root.confidence) : 0.5,
    unresolvedItems: Array.isArray(root.unresolvedItems) ? root.unresolvedItems.map(String) : [],
    warnings: Array.isArray(root.warnings) ? root.warnings.map(String) : [],
    tokenUsage,
    raw,
  };
}

export async function aiAttachmentProviderStatus() {
  const config = await loadAiProviderConfig();
  return {
    provider: config.provider,
    configured: Boolean(config.apiKey) && config.capabilities.visionOcr,
    model: config.visionModel,
    capabilities: config.capabilities,
  };
}

export async function parseAiAttachmentWithProvider(
  input: AiAttachmentProviderInput
): Promise<AiAttachmentParseResult> {
  const config = await loadAiProviderConfig();
  if (!config.capabilities.visionOcr) {
    return fallbackResult(`AI attachment provider "${config.provider}" does not support vision/OCR.`);
  }
  if (!config.apiKey) {
    return fallbackResult("AI API key is not configured, so attachment OCR/vision parsing is disabled.");
  }
  if (!input.mimeType.startsWith("image/")) {
    return fallbackResult("Only image OCR/vision provider parsing is configured right now.");
  }

  const imageUrl = `data:${input.mimeType};base64,${input.bytes.toString("base64")}`;
  const prompt =
    "Extract text from this Vietnamese business document image. It may be a sales receipt, purchase invoice, handwritten order, menu note, or product shelf/photo. Return compact JSON only with keys: " +
    "documentType:'sales_receipt'|'purchase_invoice'|'handwritten_order'|'menu_note'|'product_shelf'|'unknown', header:{supplierName?:string,customerName?:string,phone?:string,taxCode?:string,documentCode?:string,documentDate?:string,total?:number,currency?:string}, " +
    "extractedText:string, candidates:[{text:string,sku:string|null,unitName:string|null,quantity:number|null,unitCost:number|null,grossUnitCost:number|null,discount:number|null,discountRate:number|null,lineTotal:number|null,confidence:number}], " +
    "confidence:number, unresolvedItems:string[], warnings:string[]. " +
    "Do not choose an inventory, sales, pricing, or accounting action. " +
    "For candidates, return one item per invoice/table product row. Use the product code under 'Mã Hàng' as sku. " +
    "Use net unit price after discount as unitCost when a 'Giá bán' column exists; keep grossUnitCost for 'Đơn giá'. " +
    "For menu notes or shelf photos, extract visible product/menu names and quantities if shown; leave prices null when not visible. " +
    "Do not invent products. Keep Vietnamese product names, document labels, quantities, units, prices, discounts, totals, supplier/customer/header text, and codes as seen. " +
    (input.prompt ? `User prompt: ${input.prompt}` : "");

  try {
    const completion = await completeAiVision({ config, prompt, imageDataUrl: imageUrl });
    return normalizeProviderResult(completion.raw, config.provider, completion.text || outputText(completion.raw), completion.tokenUsage);
  } catch (error) {
    return {
      provider: config.provider,
      status: "failed",
      extractedText: "",
      candidates: [],
      confidence: 0,
      unresolvedItems: [],
      warnings: [error instanceof Error ? error.message : "OpenAI provider request failed."],
    };
  }
}
