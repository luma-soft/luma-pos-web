import assert from "node:assert/strict";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { AI_EVALUATION_CASES } = await import(`${PROJ}/src/lib/ai/evals.ts`);
const { aiPlannerResultSchema } = await import(`${PROJ}/src/lib/ai/planner.ts`);

assert.equal(AI_EVALUATION_CASES.length >= 8, true, "eval set covers at least 8 prompt classes");

const requiredTags = [
  "clear",
  "missing-fields",
  "ambiguous-product",
  "typo",
  "mixed-language",
  "ocr",
  "dangerous",
  "unsupported",
];
for (const tag of requiredTags) {
  assert.equal(
    AI_EVALUATION_CASES.some((item) => item.tags.includes(tag)),
    true,
    `missing eval tag ${tag}`,
  );
}

for (const item of AI_EVALUATION_CASES) {
  assert.equal(typeof item.prompt, "string", `${item.id}: prompt is string`);
  assert.equal(item.prompt.length > 0, true, `${item.id}: prompt is not empty`);
  assert.equal(Array.isArray(item.expectedMissingFields), true, `${item.id}: missing fields array`);
  assert.equal(["none", "standard", "strong"].includes(item.confirmation), true, `${item.id}: confirmation enum`);

  const parsed = aiPlannerResultSchema.safeParse({
    intent: item.expectedIntent,
    confidence: item.shouldFallback ? 0.2 : 0.9,
    canonicalPrompt: item.prompt,
    entities: {},
    missingFields: item.expectedMissingFields,
    ambiguousEntities: item.tags.includes("ambiguous-product")
      ? [{ type: "product", query: "xi măng", candidates: [{ label: "Xi măng A", confidence: 0.7 }] }]
      : [],
    warnings: item.confirmation === "strong" ? ["Dangerous bulk action requires strong confirmation."] : [],
    suggestedNextQuestion: item.expectedMissingFields.length ? "Bạn muốn áp dụng cho sản phẩm nào?" : "",
  });
  assert.equal(parsed.success, true, `${item.id}: expected planner output satisfies schema`);
}

console.log("ai planner eval dataset tests passed");
