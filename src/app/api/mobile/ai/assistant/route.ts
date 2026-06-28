import { getReports } from "@/lib/data/reports";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { attachmentPromptBlock, parseAiAttachment, type AiAttachmentMetadata } from "@/lib/ai/attachments";
import { buildAiAssistantResponse } from "@/lib/ai/actions";
import { writeAuditLog } from "@/lib/audit";
import { requireMobileManager } from "@/lib/mobile/auth";
import { mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

function sanitizeAttachmentPreview<T>(preview: T, prompt: string, attachmentCount: number): T {
  if (!preview || typeof preview !== "object" || attachmentCount === 0) return preview;
  const root = preview as Record<string, unknown>;
  const action = root.action && typeof root.action === "object"
    ? root.action as Record<string, unknown>
    : null;
  const payload = action?.payload && typeof action.payload === "object"
    ? action.payload as Record<string, unknown>
    : null;
  if (!action || !payload) return preview;
  const safePrompt = `${prompt || "Attachment command"}\n\n[${attachmentCount} attachment(s) parsed server-side]`;
  const safePayload = {
    ...payload,
    prompt: safePrompt,
    ...(typeof payload.note === "string" ? { note: "AI attachment-assisted action" } : {}),
  };
  return {
    ...root,
    action: {
      ...action,
      payload: safePayload,
    },
  } as T;
}

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
  const attachments =
    body && typeof body === "object" && Array.isArray((body as { attachments?: unknown }).attachments)
      ? ((body as { attachments: unknown[] }).attachments.filter((item): item is AiAttachmentMetadata => Boolean(item && typeof item === "object")))
      : [];
  const parsedAttachments = attachments.length
    ? await Promise.all(attachments.slice(0, 4).map((attachment) => parseAiAttachment({
        attachment,
        userId: gate.userId,
        prompt,
      })))
    : [];
  const enrichedPrompt = `${prompt}${attachmentPromptBlock(parsedAttachments)}`;
  const [reports, restock] = await Promise.all([
    getReports(30),
    getRestockSuggestions(30),
  ]);
  const response = await buildAiAssistantResponse({
    prompt: enrichedPrompt,
    revenue: reports.summary.revenue,
    collected: reports.summary.collected,
    restock,
    chartRows: reports.byDay,
  });
  if (parsedAttachments.length > 0 && response.actionPreview) {
    response.actionPreview = sanitizeAttachmentPreview(
      response.actionPreview,
      prompt,
      parsedAttachments.length,
    );
  }
  if (parsedAttachments.length > 0) {
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: "parse_ai_attachment",
      entityType: "ai_attachment",
      status: parsedAttachments.every((item) => item.status === "succeeded") ? "succeeded" : "failed",
      prompt,
      parsedIntent: {
        attachments: parsedAttachments.map((item) => ({
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          status: item.status,
          provider: item.provider,
          confidence: item.confidence,
          candidateCount: item.candidates.length,
          warningCount: item.warnings.length,
        })),
      },
      affectedRecords: parsedAttachments.map((item) => ({
        type: "ai_attachment",
        id: item.id ?? item.path ?? "attachment",
        code: item.name ?? "attachment",
      })),
      metadata: { surface: "mobile", count: parsedAttachments.length, rawContentLogged: false },
    });
  }
  await writeAuditLog({
    actorUserId: gate.userId,
    source: "ai",
    action: response.actionPreview?.intent ?? "ask_ai_assistant",
    entityType: response.actionPreview?.entityType ?? "ai_assistant",
    entityId: response.actionPreview?.entityId ?? null,
    status: response.actionPreview ? "previewed" : "succeeded",
    prompt,
    parsedIntent: response.actionPreview ?? { mode: "summary", rangeDays: 30, attachmentCount: parsedAttachments.length },
    after: {
      revenue: reports.summary.revenue,
      collected: reports.summary.collected,
      restockCount: restock.length,
    },
    metadata: { surface: "mobile" },
  });

  return mobileOk(response);
}
