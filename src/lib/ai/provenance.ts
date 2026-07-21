export type AiAssistantSource = {
  id: string;
  label: string;
  target: "reports" | "aiRestocking";
  rangeDays: number;
  generatedAt: string;
  metrics: string[];
};

export type AiAssistantFact = {
  id: string;
  label: string;
  value: number;
  unit: "VND" | "count";
  sourceId: string;
};

function nonNegativeNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function buildAssistantProvenance(input: {
  revenue: unknown;
  collected: unknown;
  restockCount: unknown;
  rangeDays: number;
  generatedAt?: Date;
}): { sources: AiAssistantSource[]; facts: AiAssistantFact[] } {
  const rangeDays = Math.max(1, Math.trunc(input.rangeDays));
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const facts: AiAssistantFact[] = [];

  const revenue = nonNegativeNumber(input.revenue);
  if (revenue != null) {
    facts.push({
      id: `revenue${rangeDays}d`,
      label: `Revenue · ${rangeDays} days`,
      value: revenue,
      unit: "VND",
      sourceId: `reports-${rangeDays}d`,
    });
  }

  const collected = nonNegativeNumber(input.collected);
  if (collected != null) {
    facts.push({
      id: `collected${rangeDays}d`,
      label: `Collected · ${rangeDays} days`,
      value: collected,
      unit: "VND",
      sourceId: `reports-${rangeDays}d`,
    });
  }

  const restockCount = nonNegativeNumber(input.restockCount);
  if (restockCount != null) {
    facts.push({
      id: `restockCount${rangeDays}d`,
      label: `Restock attention · ${rangeDays} days`,
      value: restockCount,
      unit: "count",
      sourceId: `inventory-restock-${rangeDays}d`,
    });
  }

  const reportMetrics = facts
    .filter((fact) => fact.sourceId === `reports-${rangeDays}d`)
    .map((fact) => fact.id);
  const restockMetrics = facts
    .filter((fact) => fact.sourceId === `inventory-restock-${rangeDays}d`)
    .map((fact) => fact.id);
  const sources: AiAssistantSource[] = [];
  if (reportMetrics.length) {
    sources.push({
      id: `reports-${rangeDays}d`,
      label: `Sales reports · ${rangeDays} days`,
      target: "reports",
      rangeDays,
      generatedAt,
      metrics: reportMetrics,
    });
  }
  if (restockMetrics.length) {
    sources.push({
      id: `inventory-restock-${rangeDays}d`,
      label: `Inventory restocking · ${rangeDays} days`,
      target: "aiRestocking",
      rangeDays,
      generatedAt,
      metrics: restockMetrics,
    });
  }

  return { sources, facts };
}
