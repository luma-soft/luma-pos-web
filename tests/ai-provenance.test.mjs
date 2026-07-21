import assert from "node:assert/strict";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { buildAssistantProvenance } = await import(
  `${PROJ}/src/lib/ai/provenance.ts`
);

const generatedAt = new Date("2026-07-19T08:30:00.000Z");
const result = buildAssistantProvenance({
  revenue: "1250000",
  collected: 900000,
  restockCount: 3,
  rangeDays: 30,
  generatedAt,
});

assert.deepEqual(result.sources, [
  {
    id: "reports-30d",
    label: "Sales reports · 30 days",
    target: "reports",
    rangeDays: 30,
    generatedAt: generatedAt.toISOString(),
    metrics: ["revenue30d", "collected30d"],
  },
  {
    id: "inventory-restock-30d",
    label: "Inventory restocking · 30 days",
    target: "aiRestocking",
    rangeDays: 30,
    generatedAt: generatedAt.toISOString(),
    metrics: ["restockCount30d"],
  },
]);
assert.deepEqual(result.facts, [
  {
    id: "revenue30d",
    label: "Revenue · 30 days",
    value: 1250000,
    unit: "VND",
    sourceId: "reports-30d",
  },
  {
    id: "collected30d",
    label: "Collected · 30 days",
    value: 900000,
    unit: "VND",
    sourceId: "reports-30d",
  },
  {
    id: "restockCount30d",
    label: "Restock attention · 30 days",
    value: 3,
    unit: "count",
    sourceId: "inventory-restock-30d",
  },
]);

const invalid = buildAssistantProvenance({
  revenue: "not-a-number",
  collected: null,
  restockCount: -4,
  rangeDays: 30,
  generatedAt,
});
assert.deepEqual(invalid.facts, []);
assert.deepEqual(invalid.sources, []);

console.log("ai provenance tests passed");
