import { z } from "zod";
import type { ParsedAiAttachment } from "@/lib/ai/attachments";
import type { RestockRow } from "@/lib/data/ai-restock";
import type { AiActionPreview, AiToolTrace } from "@/lib/ai/actions";
import type { AiTokenUsage } from "@/lib/ai/usage";
import { completeAiText, loadAiProviderConfig, parseJsonText } from "@/lib/ai/provider-adapter";
import { getAiToolCatalog, runAiTool, type AiToolName } from "@/lib/ai/tool-catalog";

const MAX_TOOL_LOOP_DEPTH = 4;

const TOOL_NAMES = getAiToolCatalog().map((tool) => tool.name) as [AiToolName, ...AiToolName[]];

const toolCallSchema = z.object({
  name: z.enum(TOOL_NAMES),
  query: z.string().max(300).optional(),
  prompt: z.string().max(1500).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  source: z.enum(["voice", "image"]).optional(),
});

const toolPlanSchema = z.object({
  calls: z.array(toolCallSchema).max(MAX_TOOL_LOOP_DEPTH).default([]),
  reason: z.string().max(300).default(""),
});

export type AiToolLoopInput = {
  prompt: string;
  restock: RestockRow[];
  parsedAttachments?: ParsedAiAttachment[];
  reportSummary: Record<string, unknown>;
};

export type AiToolLoopResult =
  | {
      ok: true;
      preview?: AiActionPreview;
      trace: AiToolTrace[];
      tokenUsage?: AiTokenUsage;
    }
  | {
      ok: false;
      reason: string;
      trace: AiToolTrace[];
      tokenUsage?: AiTokenUsage;
    };

function summarizeArgs(call: z.infer<typeof toolCallSchema>) {
  return {
    query: call.query ? call.query.slice(0, 120) : undefined,
    promptLength: call.prompt?.length ?? 0,
    limit: call.limit,
    source: call.source,
  };
}

function resultTrace(result: Awaited<ReturnType<typeof runAiTool>>) {
  if (result.kind === "preview") {
    return {
      state: result.preview.state,
      intent: result.preview.intent,
      entityType: result.preview.entityType,
      lineCount: result.preview.lines.length,
      warningCount: result.preview.warnings.length,
    };
  }
  if (result.kind === "records") {
    return { lineCount: result.records.length, warningCount: 0 };
  }
  return { warningCount: 0 };
}

export async function runAiToolLoop(input: AiToolLoopInput): Promise<AiToolLoopResult> {
  const config = await loadAiProviderConfig();
  const trace: AiToolTrace[] = [];
  if (!config.apiKey) return { ok: false, reason: "missing_api_key", trace };
  if (!config.capabilities.textPlanning || !config.capabilities.structuredJson) {
    return { ok: false, reason: `unsupported_tool_planning:${config.provider}`, trace };
  }

  const catalog = getAiToolCatalog()
    .map((tool) => `${tool.name}: ${tool.category}; mutation=false; ${tool.description}`)
    .join("\n");

  try {
    const completion = await completeAiText({
      config,
      jsonOnly: true,
      messages: [
        {
          role: "system",
          text:
            "You are a safe tool planner for LumaPOS. " +
            "Return JSON only. You may only choose listed tools. Tools are read/search/preview only and never mutate data. " +
            "Prefer one or two search/read tools before one preview tool when entity matching would help. Stop after a preview tool.",
        },
        {
          role: "user",
          text:
            `Tool catalog:\n${catalog}\n\n` +
            "Return schema: { calls:[{ name:string, query?:string, prompt?:string, limit?:number, source?:'voice'|'image' }], reason:string }.\n" +
            "Use the user's original Vietnamese command as prompt for preview tools. " +
            "For POS image attachments use buildPosCartPreview with source image. " +
            "For POS voice/transcript use buildPosCartPreview with source voice. " +
            "If unsupported or unclear, return calls: [].\n" +
            `Has attachments: ${input.parsedAttachments?.length ? "yes" : "no"}.\n` +
            `User command: ${input.prompt}`,
        },
      ],
    });
    const parsed = toolPlanSchema.safeParse(parseJsonText(completion.text));
    if (!parsed.success) return { ok: false, reason: "invalid_tool_plan_json", trace, tokenUsage: completion.tokenUsage };

    let preview: AiActionPreview | undefined;
    for (const [index, call] of parsed.data.calls.entries()) {
      const startedAt = Date.now();
      try {
        const result = await runAiTool({
          name: call.name,
          query: call.query,
          prompt: call.prompt || input.prompt,
          limit: call.limit,
          source: call.source,
          restock: input.restock,
          parsedAttachments: input.parsedAttachments,
          reportSummary: input.reportSummary,
        });
        trace.push({
          depth: index + 1,
          tool: call.name,
          mutation: false,
          status: "succeeded",
          durationMs: Date.now() - startedAt,
          argsSummary: summarizeArgs(call),
          result: resultTrace(result),
        });
        if (result.kind === "preview") {
          preview = result.preview;
          break;
        }
      } catch {
        trace.push({
          depth: index + 1,
          tool: call.name,
          mutation: false,
          status: "failed",
          durationMs: Date.now() - startedAt,
          argsSummary: summarizeArgs(call),
          result: { warningCount: 1 },
        });
      }
    }
    return preview
      ? { ok: true, preview, trace, tokenUsage: completion.tokenUsage }
      : { ok: false, reason: "no_preview_tool_result", trace, tokenUsage: completion.tokenUsage };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "tool_loop_failed",
      trace,
    };
  }
}
