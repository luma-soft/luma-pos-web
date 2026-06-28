import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsageCounters, aiUsageEvents } from "@/db/schema";
import { getAiProviderSettings } from "@/lib/data/settings";

export type AiUsageStatus = {
  period: string;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type AiTokenUsage = {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiUsageEventInput = {
  period?: string;
  provider?: string;
  model?: string;
  actionType?: string;
  eventType?: string;
  surface?: string;
  units?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostMicrousd?: number;
  metadata?: Record<string, unknown> | null;
};

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function normalizeLimit(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.trunc(n))) : 1000;
}

const MODEL_PRICE_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.435, output: 0.87 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
};

export function estimateAiCostMicrousd(usage: AiTokenUsage) {
  const price = usage.model ? MODEL_PRICE_PER_MILLION_TOKENS[usage.model] : null;
  if (!price) return 0;
  const usd = (usage.inputTokens / 1_000_000) * price.input + (usage.outputTokens / 1_000_000) * price.output;
  return Math.max(0, Math.round(usd * 1_000_000));
}

export async function recordAiUsageEvent(input: AiUsageEventInput) {
  const inputTokens = Math.max(0, Math.trunc(Number(input.inputTokens ?? 0)));
  const outputTokens = Math.max(0, Math.trunc(Number(input.outputTokens ?? 0)));
  const totalTokens = Math.max(inputTokens + outputTokens, Math.trunc(Number(input.totalTokens ?? 0)));
  const model = input.model || undefined;
  const estimatedCostMicrousd = input.estimatedCostMicrousd ?? estimateAiCostMicrousd({
    model,
    inputTokens,
    outputTokens,
    totalTokens,
  });
  await db.insert(aiUsageEvents).values({
    period: input.period ?? currentPeriod(),
    provider: input.provider,
    model,
    actionType: input.actionType ?? "assistant_request",
    eventType: input.eventType ?? "unit_charge",
    surface: input.surface ?? "web",
    units: Math.max(0, Math.trunc(Number(input.units ?? 0))),
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostMicrousd: Math.max(0, Math.trunc(estimatedCostMicrousd)),
    metadata: input.metadata ?? null,
  });
}

function toStatus(row: {
  period: string;
  usedUnits: number;
  limitUnits: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostMicrousd?: number;
}): AiUsageStatus {
  const used = Number(row.usedUnits);
  const limit = Number(row.limitUnits);
  const remaining = Math.max(0, limit - used);
  const estimatedCostMicrousd = Number(row.estimatedCostMicrousd ?? 0);
  return {
    period: row.period,
    used,
    limit,
    remaining,
    exhausted: remaining <= 0,
    inputTokens: Number(row.inputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
    totalTokens: Number(row.totalTokens ?? 0),
    estimatedCostUsd: estimatedCostMicrousd / 1_000_000,
  };
}

export async function getAiUsageStatus(period = currentPeriod()): Promise<AiUsageStatus> {
  const ai = await getAiProviderSettings();
  const limit = normalizeLimit(ai.monthlyUsageLimit);
  const [row] = await db
    .insert(aiUsageCounters)
    .values({ period, usedUnits: 0, limitUnits: limit })
    .onConflictDoUpdate({
      target: aiUsageCounters.period,
      set: { limitUnits: limit, updatedAt: sql`now()` },
    })
    .returning({
      period: aiUsageCounters.period,
      usedUnits: aiUsageCounters.usedUnits,
      limitUnits: aiUsageCounters.limitUnits,
      inputTokens: aiUsageCounters.inputTokens,
      outputTokens: aiUsageCounters.outputTokens,
      totalTokens: aiUsageCounters.totalTokens,
      estimatedCostMicrousd: aiUsageCounters.estimatedCostMicrousd,
    });
  return toStatus(row);
}

export async function consumeAiUsage(units: number, period = currentPeriod()) {
  const charge = Math.max(1, Math.trunc(units));
  await getAiUsageStatus(period);

  const [row] = await db
    .update(aiUsageCounters)
    .set({
      usedUnits: sql`${aiUsageCounters.usedUnits} + ${charge}`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(aiUsageCounters.period, period),
      sql`${aiUsageCounters.usedUnits} + ${charge} <= ${aiUsageCounters.limitUnits}`,
    ))
    .returning({
      period: aiUsageCounters.period,
      usedUnits: aiUsageCounters.usedUnits,
      limitUnits: aiUsageCounters.limitUnits,
      inputTokens: aiUsageCounters.inputTokens,
      outputTokens: aiUsageCounters.outputTokens,
      totalTokens: aiUsageCounters.totalTokens,
      estimatedCostMicrousd: aiUsageCounters.estimatedCostMicrousd,
    });

  if (!row) {
    return { ok: false as const, usage: await getAiUsageStatus(period), required: charge };
  }
  return { ok: true as const, usage: toStatus(row), charged: charge };
}

export async function recordAiTokenUsage(
  usage: AiTokenUsage,
  period = currentPeriod(),
  event?: Omit<AiUsageEventInput, "period" | "inputTokens" | "outputTokens" | "totalTokens" | "estimatedCostMicrousd" | "model">,
) {
  const inputTokens = Math.max(0, Math.trunc(usage.inputTokens));
  const outputTokens = Math.max(0, Math.trunc(usage.outputTokens));
  const totalTokens = Math.max(inputTokens + outputTokens, Math.trunc(usage.totalTokens));
  const estimatedCostMicrousd = estimateAiCostMicrousd({ ...usage, inputTokens, outputTokens, totalTokens });

  await getAiUsageStatus(period);
  const [row] = await db
    .update(aiUsageCounters)
    .set({
      inputTokens: sql`${aiUsageCounters.inputTokens} + ${inputTokens}`,
      outputTokens: sql`${aiUsageCounters.outputTokens} + ${outputTokens}`,
      totalTokens: sql`${aiUsageCounters.totalTokens} + ${totalTokens}`,
      estimatedCostMicrousd: sql`${aiUsageCounters.estimatedCostMicrousd} + ${estimatedCostMicrousd}`,
      updatedAt: sql`now()`,
    })
    .where(eq(aiUsageCounters.period, period))
    .returning({
      period: aiUsageCounters.period,
      usedUnits: aiUsageCounters.usedUnits,
      limitUnits: aiUsageCounters.limitUnits,
      inputTokens: aiUsageCounters.inputTokens,
      outputTokens: aiUsageCounters.outputTokens,
      totalTokens: aiUsageCounters.totalTokens,
      estimatedCostMicrousd: aiUsageCounters.estimatedCostMicrousd,
    });
  await recordAiUsageEvent({
    ...event,
    period,
    model: usage.model,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostMicrousd,
    eventType: event?.eventType ?? "token_usage",
    metadata: {
      ...(event?.metadata ?? {}),
      tokenUsageKnown: totalTokens > 0,
      ...(totalTokens === 0 ? { warning: "provider_did_not_return_token_usage" } : {}),
    },
  });
  return toStatus(row);
}
