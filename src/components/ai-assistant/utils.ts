import type { AiActionPreview } from "@/lib/ai/actions";
import type { AssistantActionPreset, AssistantActionPresetId, ComposerAttachment, FabPosition, Msg } from "./types";

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const CHAT_HISTORY_LIMIT = 80;
export const POS_AI_DRAFT_STORAGE_KEY = "luma-pos-ai-cart-draft";
export const AI_WORKFLOW_DRAFT_STORAGE_KEY = "luma-ai-workflow-draft";
export const FAB_MARGIN = 12;
export const FAB_MOVE_THRESHOLD = 10;

export const ACCEPTED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function actionPresetById(presets: AssistantActionPreset[], id: string | null | undefined) {
  return presets.find((preset) => preset.id === id) ?? null;
}

export function readSessionPresetMap(key: string, presets: AssistantActionPreset[]): Record<string, AssistantActionPresetId> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, AssistantActionPresetId] =>
        Boolean(actionPresetById(presets, entry[1] as string))
      )
    );
  } catch {
    return {};
  }
}

export function writeSessionPresetMap(key: string, map: Record<string, AssistantActionPresetId>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // Ignore private-mode/quota failures; action mode still works for the current session.
  }
}

export function actionPromptForPreset(preset: AssistantActionPreset, userText: string) {
  return `${preset.promptPrefix}\n\n${userText.trim()}`;
}

export function isPosCartPreview(preview: AiActionPreview) {
  return preview.intent === "pos_voice_cart_draft" || preview.intent === "pos_image_cart_draft";
}

export function posDraftItems(preview: AiActionPreview): unknown[] {
  const items = preview.action.payload.items;
  return Array.isArray(items) ? items : [];
}

export function posDraftProductIds(preview: AiActionPreview) {
  return posDraftItems(preview)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const productId = (item as { productId?: unknown }).productId;
      return typeof productId === "string" && productId.trim() ? productId.trim() : "";
    })
    .filter(Boolean);
}

export function posDraftHref(preview: AiActionPreview) {
  const ids = [...new Set(posDraftProductIds(preview))];
  return ids.length ? `/pos?aiDraft=1&aiProducts=${encodeURIComponent(ids.join(","))}` : "/pos?aiDraft=1";
}

export function recordWithPosDraftHref(record: Msg["record"] | undefined, preview: AiActionPreview): Msg["record"] | undefined {
  if (!record || !isPosCartPreview(preview)) return record;
  return { ...record, href: posDraftHref(preview) };
}

export function storePosDraft(preview: AiActionPreview) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POS_AI_DRAFT_STORAGE_KEY, JSON.stringify({
      previewId: preview.id,
      intent: preview.intent,
      items: posDraftItems(preview),
      payload: preview.action.payload,
      createdAt: Date.now(),
    }));
  } catch {
    // Ignore quota/private-mode failures; the query link still carries product ids.
  }
}

export function storeAiWorkflowDraft(preview: AiActionPreview) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_WORKFLOW_DRAFT_STORAGE_KEY, JSON.stringify({
      previewId: preview.id,
      intent: preview.intent,
      entityType: preview.entityType,
      action: preview.action,
      fields: preview.fields,
      lines: preview.lines,
      warnings: preview.warnings,
      createdAt: Date.now(),
    }));
  } catch {
    // Ignore quota/private-mode failures; the review link still opens the workflow.
  }
}

export function dispatchPosDraft(preview: AiActionPreview) {
  window.dispatchEvent(new CustomEvent("luma:pos-ai-cart-draft", {
    detail: {
      previewId: preview.id,
      intent: preview.intent,
      items: posDraftItems(preview),
    },
  }));
}

export function sanitizeAttachmentForStorage(attachment: ComposerAttachment): ComposerAttachment {
  const sanitized = { ...attachment };
  delete sanitized.previewUrl;
  delete sanitized.localId;
  return {
    ...sanitized,
    status: attachment.status === "uploading" ? "uploaded" : attachment.status,
  };
}

export function sanitizeMessagesForStorage(messages: Msg[]): Msg[] {
  return messages.slice(-CHAT_HISTORY_LIMIT).map((message) => ({
    ...message,
    attachments: message.attachments?.map(sanitizeAttachmentForStorage),
  }));
}

export function readChatHistory(key: string): Msg[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Msg => {
      if (!item || typeof item !== "object") return false;
      const msg = item as Partial<Msg>;
      return (msg.role === "user" || msg.role === "assistant") && typeof msg.text === "string";
    }).slice(-CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function attachmentKind(type: string): ComposerAttachment["kind"] | null {
  if (type.startsWith("image/") && ACCEPTED_ATTACHMENT_TYPES.has(type)) return "image";
  if (ACCEPTED_ATTACHMENT_TYPES.has(type)) return "document";
  return null;
}

export function fileSizeText(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function clampFabPosition(position: FabPosition, size: number): FabPosition {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(Math.max(FAB_MARGIN, position.x), Math.max(FAB_MARGIN, window.innerWidth - size - FAB_MARGIN)),
    y: Math.min(Math.max(FAB_MARGIN, position.y), Math.max(FAB_MARGIN, window.innerHeight - size - FAB_MARGIN)),
  };
}

export function readFabPosition(key: string, size: number): FabPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FabPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return clampFabPosition({ x: parsed.x, y: parsed.y }, size);
  } catch {
    return null;
  }
}

export function saveFabPosition(key: string, position: FabPosition) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(position));
}
