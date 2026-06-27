import { getReports } from "@/lib/data/reports";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { buildAiAssistantResponse } from "@/lib/ai/actions";
import { writeAuditLog } from "@/lib/audit";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;

  const body = await readJson(request);
  const prompt =
    body && typeof body === "object" && "prompt" in body
      ? String((body as { prompt?: unknown }).prompt ?? "")
      : "";
  const [reports, restock] = await Promise.all([
    getReports(30),
    getRestockSuggestions(30),
  ]);
  const response = await buildAiAssistantResponse({
    prompt,
    revenue: reports.summary.revenue,
    collected: reports.summary.collected,
    restock,
    chartRows: reports.byDay,
  });
  await writeAuditLog({
    actorUserId: gate.userId,
    source: "ai",
    action: response.actionPreview?.intent ?? "ask_ai_assistant",
    entityType: response.actionPreview?.entityType ?? "ai_assistant",
    entityId: response.actionPreview?.entityId ?? null,
    status: response.actionPreview ? "previewed" : "succeeded",
    prompt,
    parsedIntent: response.actionPreview ?? { mode: "summary", rangeDays: 30 },
    after: {
      revenue: reports.summary.revenue,
      collected: reports.summary.collected,
      restockCount: restock.length,
    },
    metadata: { surface: "mobile" },
  });

  return mobileOk(response);
}
