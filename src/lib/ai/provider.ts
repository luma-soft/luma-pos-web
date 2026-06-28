export type AiAttachmentCandidate = {
  text: string;
  quantity?: number | null;
  confidence: number;
};

export type AiAttachmentParseResult = {
  provider: "none" | "openai";
  status: "succeeded" | "unavailable" | "failed";
  extractedText: string;
  candidates: AiAttachmentCandidate[];
  confidence: number;
  unresolvedItems: string[];
  warnings: string[];
  raw?: unknown;
};

export type AiAttachmentProviderInput = {
  name: string;
  mimeType: string;
  bytes: Buffer;
  prompt?: string;
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

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

function parseJsonText(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as Partial<AiAttachmentParseResult>;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Partial<AiAttachmentParseResult>;
    } catch {
      return null;
    }
  }
}

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

function normalizeProviderResult(raw: unknown): AiAttachmentParseResult {
  const text = outputText(raw);
  const parsed = parseJsonText(text);
  if (!parsed) {
    return {
      provider: "openai",
      status: "succeeded",
      extractedText: text,
      candidates: [],
      confidence: text ? 0.5 : 0,
      unresolvedItems: [],
      warnings: text ? [] : ["Provider returned an empty response."],
      raw,
    };
  }
  return {
    provider: "openai",
    status: "succeeded",
    extractedText: typeof parsed.extractedText === "string" ? parsed.extractedText : text,
    candidates: Array.isArray(parsed.candidates)
      ? parsed.candidates.map((candidate) => ({
          text: String((candidate as { text?: unknown }).text ?? ""),
          quantity: Number.isFinite(Number((candidate as { quantity?: unknown }).quantity))
            ? Number((candidate as { quantity?: unknown }).quantity)
            : null,
          confidence: Number.isFinite(Number((candidate as { confidence?: unknown }).confidence))
            ? Number((candidate as { confidence?: unknown }).confidence)
            : 0.5,
        })).filter((candidate) => candidate.text)
      : [],
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0.5,
    unresolvedItems: Array.isArray(parsed.unresolvedItems) ? parsed.unresolvedItems.map(String) : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    raw,
  };
}

export function aiAttachmentProviderStatus() {
  const provider = process.env.AI_ATTACHMENT_PROVIDER || "openai";
  const apiKey = process.env.OPENAI_API_KEY;
  return {
    provider,
    configured: provider === "openai" && Boolean(apiKey),
    model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
  };
}

export async function parseAiAttachmentWithProvider(
  input: AiAttachmentProviderInput
): Promise<AiAttachmentParseResult> {
  const status = aiAttachmentProviderStatus();
  if (status.provider !== "openai") {
    return fallbackResult(`AI attachment provider "${status.provider}" is not supported yet.`);
  }
  if (!process.env.OPENAI_API_KEY) {
    return fallbackResult("OPENAI_API_KEY is not configured, so attachment OCR/vision parsing is disabled.");
  }
  if (!input.mimeType.startsWith("image/")) {
    return fallbackResult("Only image OCR/vision provider parsing is configured right now.");
  }

  const imageUrl = `data:${input.mimeType};base64,${input.bytes.toString("base64")}`;
  const body = {
    model: status.model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Extract POS order text from this image. Return compact JSON only with keys: " +
              "extractedText:string, candidates:[{text:string,quantity:number|null,confidence:number}], " +
              "confidence:number, unresolvedItems:string[], warnings:string[]. " +
              "Do not invent products. Keep Vietnamese product names as seen. " +
              (input.prompt ? `User prompt: ${input.prompt}` : ""),
          },
          {
            type: "input_image",
            image_url: imageUrl,
            detail: "low",
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
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        provider: "openai",
        status: "failed",
        extractedText: "",
        candidates: [],
        confidence: 0,
        unresolvedItems: [],
        warnings: [json?.error?.message ?? `OpenAI provider failed with ${response.status}`],
        raw: json,
      };
    }
    return normalizeProviderResult(json);
  } catch (error) {
    return {
      provider: "openai",
      status: "failed",
      extractedText: "",
      candidates: [],
      confidence: 0,
      unresolvedItems: [],
      warnings: [error instanceof Error ? error.message : "OpenAI provider request failed."],
    };
  }
}
