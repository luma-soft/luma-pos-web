import { getReports } from "@/lib/data/reports";
import { getRestockSuggestions } from "@/lib/data/ai-restock";
import { requireAiProviderConfigured } from "@/lib/ai/config";
import { buildAttachmentNextActionResponse, shouldAskAttachmentNextAction } from "@/lib/ai/attachment-intent";
import { attachmentPromptBlock, parseAiAttachment, type AiAttachmentMetadata, type ParsedAiAttachment } from "@/lib/ai/attachments";
import { buildAiAssistantResponse, withAiPreviewReviewAction, type AiAssistantResponse } from "@/lib/ai/actions";
import { buildAssistantProvenance } from "@/lib/ai/provenance";
import { loadAiProviderConfig } from "@/lib/ai/provider-adapter";
import { runAiToolLoop } from "@/lib/ai/tool-loop";
import { consumeAiUsage, recordAiTokenUsage, recordAiUsageEvent } from "@/lib/ai/usage";
import { writeAuditLog } from "@/lib/audit";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk, readJson } from "@/lib/mobile/response";

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

function attachmentAuditDetails(parsedAttachments: ParsedAiAttachment[]) {
  return parsedAttachments.map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    status: item.status,
    provider: item.provider,
    documentType: item.documentType ?? "unknown",
    headerFields: item.header ? Object.keys(item.header) : [],
    confidence: item.confidence,
    candidateCount: item.candidates.length,
    warningCount: item.warnings.length,
  }));
}

function canPreviewAiAction(role: string, actionType?: string, target?: string) {
  if (role === "owner" || role === "manager") return true;
  if (role === "warehouse") {
    return target === "purchases" || target === "inventory" || target === "products";
  }
  if (role === "cashier") {
    return target === "pos" || target === "orders" || actionType === "create_order";
  }
  return false;
}

function hasForcedActionPreset(prompt: string) {
  return /\[AI_ACTION_PRESET:[a-z_]+\]/.test(prompt);
}

async function writeAttachmentParseAudit(input: {
  userId: string;
  prompt: string;
  parsedAttachments: ParsedAiAttachment[];
}) {
  if (input.parsedAttachments.length === 0) return;
  await writeAuditLog({
    actorUserId: input.userId,
    source: "ai",
    action: "parse_ai_attachment",
    entityType: "ai_attachment",
    status: input.parsedAttachments.every((item) => item.status === "succeeded") ? "succeeded" : "failed",
    prompt: input.prompt,
    parsedIntent: {
      attachments: attachmentAuditDetails(input.parsedAttachments),
    },
    affectedRecords: input.parsedAttachments.map((item) => ({
      type: "ai_attachment",
      id: item.id ?? item.path ?? "attachment",
      code: item.name ?? "attachment",
    })),
    metadata: { surface: "mobile", count: input.parsedAttachments.length, rawContentLogged: false },
  });
}

export async function POST(request: Request) {
  const gate = await requireMobileUser();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileGate(gate)!;
  const aiBlocked = await requireAiProviderConfigured();
  if (aiBlocked) return aiBlocked;

  const body = await readJson(request);
  const prompt =
    body && typeof body === "object" && "prompt" in body
      ? String((body as { prompt?: unknown }).prompt ?? "")
      : "";
  const surface =
    body && typeof body === "object" && (body as { surface?: unknown }).surface === "pos"
      ? "pos"
      : "mobile";
  const attachments =
    body && typeof body === "object" && Array.isArray((body as { attachments?: unknown }).attachments)
      ? ((body as { attachments: unknown[] }).attachments.filter((item): item is AiAttachmentMetadata => Boolean(item && typeof item === "object")))
      : [];
  const usage = await consumeAiUsage(1 + attachments.slice(0, 4).length);
  if (!usage.ok) {
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: "ai_usage_exhausted",
      entityType: "ai_usage",
      status: "failed",
      prompt,
      metadata: {
        required: usage.required,
        used: usage.usage.used,
        limit: usage.usage.limit,
        remaining: usage.usage.remaining,
      },
    });
    return mobileError("ai.usage.exhausted", 402);
  }
  const providerConfig = await loadAiProviderConfig().catch(() => null);
  await recordAiUsageEvent({
    provider: providerConfig?.provider,
    model: providerConfig?.textModel,
    actionType: "assistant_request",
    eventType: "unit_charge",
    surface,
    units: usage.charged,
    metadata: {
      attachmentCount: attachments.slice(0, 4).length,
      providerSupportsTokenUsage: providerConfig?.capabilities.tokenUsage ?? null,
    },
  });
  const parsedAttachments = attachments.length
    ? await Promise.all(attachments.slice(0, 4).map((attachment) => parseAiAttachment({
        attachment,
        userId: gate.userId,
        prompt,
      })))
    : [];
  for (const item of parsedAttachments) {
    if (item.tokenUsage) {
      usage.usage = await recordAiTokenUsage(item.tokenUsage, undefined, {
        provider: item.provider,
        surface,
        actionType: "attachment_parse",
        metadata: {
          attachmentId: item.id,
          mimeType: item.mimeType,
          documentType: item.documentType ?? "unknown",
        },
      });
    } else if (item.provider !== "none") {
      await recordAiUsageEvent({
        provider: item.provider,
        actionType: "attachment_parse",
        eventType: "token_usage",
        surface,
        metadata: {
          attachmentId: item.id,
          mimeType: item.mimeType,
          warning: "provider_did_not_return_token_usage",
        },
      });
    }
  }
  const shouldBuildPosImageCart = surface === "pos" && parsedAttachments.length > 0;
  if (!shouldBuildPosImageCart && shouldAskAttachmentNextAction(prompt, parsedAttachments.length)) {
    const response = buildAttachmentNextActionResponse({ prompt, attachments: parsedAttachments });
    await writeAttachmentParseAudit({ userId: gate.userId, prompt, parsedAttachments });
    await writeAuditLog({
      actorUserId: gate.userId,
      source: "ai",
      action: "ask_attachment_next_action",
      entityType: "ai_attachment",
      status: "succeeded",
      prompt,
      parsedIntent: {
        mode: "needs_user_next_action",
        attachmentCount: parsedAttachments.length,
        attachments: attachmentAuditDetails(parsedAttachments),
      },
      metadata: { surface, rawContentLogged: false, usageUnits: usage.charged },
    });
    return mobileOk({
      ...response,
      aiUsage: usage.usage,
      cloudProcessing: {
        enabled: true,
        provider: providerConfig?.provider ?? "configured_provider",
        attachmentCount: parsedAttachments.length,
      },
    });
  }
  const basePrompt = shouldBuildPosImageCart
    ? `Tạo giỏ POS từ ảnh. ${prompt || "Đọc sản phẩm và số lượng từ file đính kèm."}`
    : prompt;
  const enrichedPrompt = `${basePrompt}${attachmentPromptBlock(parsedAttachments)}`;
  const [reports, restock] = await Promise.all([
    getReports(30),
    getRestockSuggestions(30),
  ]);
  const toolLoop = hasForcedActionPreset(enrichedPrompt)
    ? { ok: false as const, reason: "forced_action_preset", trace: [] }
    : await runAiToolLoop({
        prompt: enrichedPrompt,
        restock,
        parsedAttachments,
        reportSummary: {
          revenue: reports.summary.revenue,
          collected: reports.summary.collected,
          rangeDays: 30,
          restockCount: restock.length,
        },
      });
  if (toolLoop.tokenUsage) {
    usage.usage = await recordAiTokenUsage(toolLoop.tokenUsage, undefined, {
      provider: providerConfig?.provider,
      surface,
      actionType: "tool_loop",
      metadata: { traceCount: toolLoop.trace.length },
    });
  } else if (providerConfig?.apiKey) {
    await recordAiUsageEvent({
      provider: providerConfig.provider,
      model: providerConfig.textModel,
      actionType: "tool_loop",
      eventType: "token_usage",
      surface,
      metadata: {
        traceCount: toolLoop.trace.length,
        warning: "provider_did_not_return_token_usage",
      },
    });
  }
  let response: AiAssistantResponse;
  if (toolLoop.ok && toolLoop.preview) {
    const isReportPreview = toolLoop.preview.intent === "report_summary" || toolLoop.preview.intent === "customer_report";
    response = {
      text: toolLoop.preview.description,
      state: toolLoop.preview.state,
      prompt: enrichedPrompt,
      actionPreview: toolLoop.preview,
      actions: [{ type: "open", target: toolLoop.preview.action.target, label: "Open related screen" }],
      chart: isReportPreview ? { type: "revenueByDay", rows: reports.byDay } : undefined,
      toolTrace: toolLoop.trace,
    };
  } else {
    response = await buildAiAssistantResponse({
      prompt: enrichedPrompt,
      revenue: reports.summary.revenue,
      collected: reports.summary.collected,
      restock,
      chartRows: reports.byDay,
      parsedAttachments,
      surface,
    });
    response.toolTrace = [...(toolLoop.trace ?? []), ...(response.toolTrace ?? [])];
  }
  if (parsedAttachments.length > 0 && response.actionPreview) {
    response.actionPreview = sanitizeAttachmentPreview(
      response.actionPreview,
      prompt,
      parsedAttachments.length,
    );
  }
  if (response.actionPreview) {
    response.actionPreview = withAiPreviewReviewAction(response.actionPreview);
    response.actions = [{ type: "open", target: response.actionPreview.reviewAction?.target ?? response.actionPreview.action.target, label: response.actionPreview.reviewAction?.label ?? "Open related screen" }];
  }
  if (
    response.actionPreview &&
    !canPreviewAiAction(
      gate.role,
      response.actionPreview.action.type,
      response.actionPreview.action.target,
    )
  ) {
    response.state = "unauthorized";
    response.text = "Bạn không có quyền thực hiện preview AI này. AI không thay đổi dữ liệu.";
    response.actions = [];
    response.actionPreview = {
      ...response.actionPreview,
      state: "unauthorized",
      warnings: [...response.actionPreview.warnings, "Không đủ quyền theo vai trò hiện tại."],
    };
  }
  await writeAttachmentParseAudit({ userId: gate.userId, prompt, parsedAttachments });
  await writeAuditLog({
    actorUserId: gate.userId,
    source: "ai",
    action: response.actionPreview?.intent ?? "ask_ai_assistant",
    entityType: response.actionPreview?.entityType ?? "ai_assistant",
    entityId: response.actionPreview?.entityId ?? null,
    status: response.state === "unauthorized" ? "unauthorized" : response.actionPreview ? "previewed" : "succeeded",
    prompt,
    parsedIntent: response.actionPreview ?? { mode: "summary", rangeDays: 30, attachmentCount: parsedAttachments.length },
    after: {
      revenue: reports.summary.revenue,
      collected: reports.summary.collected,
      restockCount: restock.length,
    },
    metadata: { surface, usageUnits: usage.charged, toolTrace: response.toolTrace ?? [] },
  });

  const provenance = buildAssistantProvenance({
    revenue: reports.summary.revenue,
    collected: reports.summary.collected,
    restockCount: restock.length,
    rangeDays: 30,
    generatedAt: new Date(reports.generatedAt),
  });
  const isRestockPreview = response.actionPreview?.intent === "create_draft_purchase_order_from_restocking";
  const sourceBackedResponse = Boolean(response.chart) || isRestockPreview;
  const selectedFacts = sourceBackedResponse
    ? provenance.facts.filter((fact) => !isRestockPreview || fact.sourceId === "inventory-restock-30d")
    : [];
  const selectedSourceIds = new Set(selectedFacts.map((fact) => fact.sourceId));
  const selectedSources = provenance.sources.filter((source) => selectedSourceIds.has(source.id));
  if (response.chart) {
    response.chart = { ...response.chart, sourceId: "reports-30d" };
  }

  return mobileOk({
    ...response,
    aiUsage: usage.usage,
    cloudProcessing: {
      enabled: true,
      provider: providerConfig?.provider ?? "configured_provider",
      attachmentCount: parsedAttachments.length,
    },
    sources: selectedSources,
    facts: selectedFacts,
  });
}
