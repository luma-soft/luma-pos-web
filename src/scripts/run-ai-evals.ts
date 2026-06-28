import { AI_EVALUATION_CASES, type AiEvaluationCase } from "@/lib/ai/evals";
import { loadAiProviderConfig } from "@/lib/ai/provider-adapter";
import { planAiAssistantIntent, type AiPlannerIntent } from "@/lib/ai/planner";
import { normalizeSearch } from "@/lib/normalize";

type EvalMode = "rule" | "llm";

type EvalOutput = {
  intent: AiPlannerIntent;
  missingFields: string[];
  previewType: string;
  confirmation: AiEvaluationCase["confirmation"];
  shouldFallback: boolean;
};

type EvalRow = EvalOutput & {
  id: string;
  mode: EvalMode;
  ok: boolean;
  expectedIntent: AiPlannerIntent;
  expectedPreviewType: string;
  expectedConfirmation: AiEvaluationCase["confirmation"];
  expectedFallback: boolean;
  errors: string[];
};

const INTENT_TO_PREVIEW: Partial<Record<AiPlannerIntent, string>> = {
  create_draft_purchase_order_from_restocking: "draft_purchase_order",
  create_inventory_inbound: "inventory_inbound",
  set_product_price: "price_update",
  apply_price_formula: "price_formula",
  product_command: "product",
  customer_action: "customer",
  cashbook_action: "cashbook_entry",
  order_action: "order",
  pos_voice_cart_draft: "pos_cart_draft",
  pos_image_cart_draft: "pos_cart_draft",
};

const STRONG_INTENTS = new Set<AiPlannerIntent>([
  "apply_price_formula",
  "cashbook_action",
  "order_action",
]);

function confirmationFor(intent: AiPlannerIntent, previewType: string): AiEvaluationCase["confirmation"] {
  if (intent === "unknown" || previewType === "none") return "none";
  return STRONG_INTENTS.has(intent) ? "strong" : "standard";
}

function rulePlanner(prompt: string): EvalOutput {
  const normalized = normalizeSearch(prompt);
  const words = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  const hasAiAttachment = normalized.includes("ai attachment parse");
  const hasPos = normalized.includes("pos") || normalized.includes("gio pos") || normalized.includes("gio hang");
  let intent: AiPlannerIntent = "unknown";
  const missingFields: string[] = [];

  if ((normalized.includes("po") || normalized.includes("phieu nhap")) && normalized.includes("sap het")) {
    intent = "create_draft_purchase_order_from_restocking";
  } else if (hasAiAttachment || normalized.includes("ocr") || words.has("anh")) {
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

  const previewType = INTENT_TO_PREVIEW[intent] ?? "none";
  return {
    intent,
    missingFields,
    previewType,
    confirmation: confirmationFor(intent, previewType),
    shouldFallback: intent === "unknown",
  };
}

function compare(mode: EvalMode, item: AiEvaluationCase, actual: EvalOutput): EvalRow {
  const errors: string[] = [];
  if (actual.intent !== item.expectedIntent) errors.push(`intent ${actual.intent} != ${item.expectedIntent}`);
  if (actual.previewType !== item.expectedPreviewType) errors.push(`preview ${actual.previewType} != ${item.expectedPreviewType}`);
  if (actual.confirmation !== item.confirmation) errors.push(`confirmation ${actual.confirmation} != ${item.confirmation}`);
  if (actual.shouldFallback !== item.shouldFallback) errors.push(`fallback ${actual.shouldFallback} != ${item.shouldFallback}`);
  for (const field of item.expectedMissingFields) {
    if (!actual.missingFields.includes(field)) errors.push(`missingFields lacks ${field}`);
  }
  return {
    id: item.id,
    mode,
    ok: errors.length === 0,
    expectedIntent: item.expectedIntent,
    expectedPreviewType: item.expectedPreviewType,
    expectedConfirmation: item.confirmation,
    expectedFallback: item.shouldFallback,
    errors,
    ...actual,
  };
}

async function runRuleEvals() {
  return AI_EVALUATION_CASES.map((item) => compare("rule", item, rulePlanner(item.prompt)));
}

async function runLlmEvals() {
  const config = await loadAiProviderConfig().catch(() => null);
  if (!config?.apiKey) {
    console.log("ai eval llm mode skipped: missing API key");
    return [];
  }
  if (!config.capabilities.textPlanning) {
    console.log(`ai eval llm mode skipped: provider ${config.provider} has no text planning`);
    return [];
  }
  const rows: EvalRow[] = [];
  for (const item of AI_EVALUATION_CASES) {
    const result = await planAiAssistantIntent({ prompt: item.prompt, hasAttachments: item.tags.includes("ocr") });
    if (!result.ok) {
      rows.push(compare("llm", item, {
        intent: "unknown",
        missingFields: [],
        previewType: "none",
        confirmation: "none",
        shouldFallback: true,
      }));
      rows[rows.length - 1].errors.push(result.reason);
      continue;
    }
    const intent = result.plan.confidence >= 0.55 ? result.plan.intent : "unknown";
    const previewType = INTENT_TO_PREVIEW[intent] ?? "none";
    rows.push(compare("llm", item, {
      intent,
      missingFields: result.plan.missingFields,
      previewType,
      confirmation: confirmationFor(intent, previewType),
      shouldFallback: intent === "unknown",
    }));
  }
  return rows;
}

function printRows(rows: EvalRow[]) {
  for (const row of rows) {
    const status = row.ok ? "PASS" : "FAIL";
    console.log(`${status} ${row.mode} ${row.id}: intent=${row.intent} preview=${row.previewType} confirmation=${row.confirmation} fallback=${row.shouldFallback}`);
    for (const error of row.errors) console.log(`  - ${error}`);
  }
}

const modeArg = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ?? "all";
const rows = [
  ...(["all", "rule"].includes(modeArg) ? await runRuleEvals() : []),
  ...(["all", "llm"].includes(modeArg) ? await runLlmEvals() : []),
];

printRows(rows);

const failed = rows.filter((row) => !row.ok);
if (failed.length > 0) {
  console.error(`ai eval failed: ${failed.length}/${rows.length}`);
  process.exit(1);
}
console.log(`ai eval passed: ${rows.length}/${rows.length}`);
