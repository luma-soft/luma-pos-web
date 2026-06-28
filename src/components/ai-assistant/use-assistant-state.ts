"use client";

import { type ClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getAssistantActionPresets } from "./action-presets";
import { deleteJson, getJson, postJson, putJson, uploadAiAttachment } from "./api";
import type {
  AssistantActionPreset,
  AssistantActionPresetId,
  AiSessionSummary,
  AssistantController,
  AssistantResponse,
  AssistantSurface,
  ComposerAttachment,
  Msg,
  PreviewResolutionState,
  SpeechRecognitionCtor,
} from "./types";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  actionPresetById,
  actionPromptForPreset,
  attachmentKind,
  dispatchPosDraft,
  isPosCartPreview,
  posDraftItems,
  readChatHistory,
  readSessionPresetMap,
  recordWithPosDraftHref,
  sanitizeMessagesForStorage,
  storePosDraft,
  writeSessionPresetMap,
} from "./utils";

function serverMessagesToChat(messages: unknown[]): Msg[] {
  return messages.map((item) => {
    const msg = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      role: msg.role === "assistant" ? "assistant" : "user",
      text: typeof msg.content === "string" ? msg.content : "",
      attachments: Array.isArray(msg.attachments) ? msg.attachments as ComposerAttachment[] : undefined,
      state: typeof msg.state === "string" ? msg.state as PreviewResolutionState : undefined,
      preview: msg.preview && typeof msg.preview === "object" ? msg.preview as Msg["preview"] : undefined,
      result: typeof msg.result === "string" ? msg.result : undefined,
      record: msg.record && typeof msg.record === "object" ? msg.record as Msg["record"] : undefined,
    } satisfies Msg;
  }).filter((msg) => msg.text);
}

function serverSessions(value: unknown, defaultTitle: string): AiSessionSummary[] {
  const sessions = value && typeof value === "object" && Array.isArray((value as { sessions?: unknown }).sessions)
    ? (value as { sessions: unknown[] }).sessions
    : [];
  return sessions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string") return [];
    return [{
      id: raw.id,
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title : defaultTitle,
      surface: raw.surface === "pos" ? "pos" : "web",
      messageCount: typeof raw.messageCount === "number" ? raw.messageCount : undefined,
    }];
  });
}

export function useAssistantState(surface: AssistantSurface): AssistantController {
  const t = useTranslations();
  const defaultSessionTitle = t("ai.defaultSessionTitle");
  const webActionPresets = useMemo(() => getAssistantActionPresets(t), [t]);
  const actionPresets = useMemo(() => surface === "web" ? webActionPresets : [], [surface, webActionPresets]);
  const chatHistoryKey = `luma-ai-chat-history:${surface}`;
  const sessionPresetKey = `luma-ai-session-action-preset:${surface}`;
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>(() => readChatHistory(chatHistoryKey));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [activePresetId, setActivePresetId] = useState<AssistantActionPresetId | null>(null);
  const [serverHydrated, setServerHydrated] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AssistantController["usage"]>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePreset = actionPresetById(actionPresets, activePresetId);

  useEffect(() => {
    window.localStorage.setItem(chatHistoryKey, JSON.stringify(sanitizeMessagesForStorage(msgs)));
  }, [chatHistoryKey, msgs]);

  const loadServerSession = useCallback(async (id: string) => {
    const loaded = await getJson(`/api/mobile/ai/sessions?sessionId=${id}`);
    const messages = Array.isArray((loaded as { messages?: unknown }).messages)
      ? (loaded as { messages: unknown[] }).messages
      : [];
    setSessionId(id);
    setMsgs(serverMessagesToChat(messages));
    setActivePresetId(readSessionPresetMap(sessionPresetKey, actionPresets)[id] ?? null);
  }, [actionPresets, sessionPresetKey]);

  const refreshSessions = useCallback(async (selectLatest = false) => {
    const data = await getJson(`/api/mobile/ai/sessions?surface=${surface}`);
    const next = serverSessions(data, defaultSessionTitle);
    setSessions(next);
    if (selectLatest && next[0]) await loadServerSession(next[0].id);
    return next;
  }, [defaultSessionTitle, loadServerSession, surface]);

  useEffect(() => {
    let cancelled = false;
    refreshSessions(false)
      .then(async (data) => {
        if (cancelled) return;
        const firstId = data[0]?.id ?? null;
        if (!firstId) {
          setServerHydrated(true);
          return;
        }
        if (cancelled) return;
        await loadServerSession(firstId);
        setServerHydrated(true);
      })
      .catch(() => { if (!cancelled) setServerHydrated(true); });
    return () => { cancelled = true; };
  }, [loadServerSession, refreshSessions]);

  useEffect(() => {
    if (!serverHydrated) return;
    if (msgs.length === 0) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      void putJson("/api/mobile/ai/sessions", {
        sessionId,
        surface,
        title: activePreset?.sessionTitle ?? (msgs.find((msg) => msg.role === "user")?.text.slice(0, 80) || defaultSessionTitle),
        messages: sanitizeMessagesForStorage(msgs),
      }).then((data) => {
        const id = (data as { session?: { id?: unknown } }).session?.id;
        if (typeof id === "string") setSessionId(id);
        void refreshSessions(false).catch(() => {});
      }).catch(() => {});
    }, 500);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [activePreset, defaultSessionTitle, msgs, refreshSessions, serverHydrated, sessionId, surface]);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/mobile/ai/usage")
      .then((data) => { if (!cancelled) setUsage(data as AssistantController["usage"]); })
      .catch(() => { if (!cancelled) setUsage(null); });
    return () => { cancelled = true; };
  }, []);

  const suggestionGroups = activePreset
    ? []
    : surface === "pos"
      ? [
          {
            id: "pos-actions",
            title: t("ai.suggestionGroups.posActions"),
            items: [t("ai.suggestions.posVoiceCart"), t("ai.suggestions.posFindLowStockCart")],
          },
          {
            id: "quick-checks",
            title: t("ai.suggestionGroups.quickChecks"),
            items: [t("ai.q.lowStock"), t("ai.q.todaySales")],
          },
        ]
      : [
          {
            id: "business",
            title: t("ai.suggestionGroups.business"),
            items: [t("ai.q.todaySales"), t("ai.q.topSellers"), t("ai.q.lowStock")],
          },
          {
            id: "drafts",
            title: t("ai.suggestionGroups.drafts"),
            items: [t("ai.q.restockToday"), t("ai.suggestions.receiveRobusta"), t("ai.suggestions.setSkuPrice")],
          },
        ];
  const suggestions = suggestionGroups.flatMap((group) => group.items);

  function addFiles(files: FileList | File[]) {
    const next: ComposerAttachment[] = [];
    setAttachmentError(null);
    for (const file of Array.from(files)) {
      if (attachments.length + next.length >= MAX_ATTACHMENTS) {
        setAttachmentError(t("ai.errors.tooManyAttachments", { max: MAX_ATTACHMENTS }));
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentError(t("ai.errors.attachmentTooLarge", { name: file.name }));
        continue;
      }
      const kind = attachmentKind(file.type);
      if (!kind) {
        setAttachmentError(t("ai.errors.unsupportedAttachment", { name: file.name }));
        continue;
      }
      const localId = `${Date.now()}-${crypto.randomUUID()}`;
      const localAttachment: ComposerAttachment = {
        id: localId,
        localId,
        name: file.name || (kind === "image" ? "clipboard-image.png" : "attachment"),
        mimeType: file.type,
        size: file.size,
        kind,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        status: "uploading",
      };
      next.push(localAttachment);
      void uploadAiAttachment(file)
        .then((uploaded) => {
          setAttachments((current) => current.map((item) => item.localId === localId
            ? { ...item, ...uploaded, localId, previewUrl: item.previewUrl, status: "uploaded" }
            : item));
        })
        .catch((error) => {
          setAttachments((current) => current.map((item) => item.localId === localId
            ? { ...item, status: "failed", error: error instanceof Error ? error.message : t("ai.errors.uploadFailed") }
            : item));
        });
    }
    if (next.length) setAttachments((current) => [...current, ...next]);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const found = current.find((item) => item.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  }

  function startVoiceInput() {
    if (typeof window === "undefined" || busy || listening) return;
    const SpeechRecognition =
      (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setAttachmentError(t("ai.errors.speechUnsupported"));
      return;
    }
    setAttachmentError(null);
    const recognition = new SpeechRecognition();
    recognition.lang = "vi-VN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) {
        setInput(transcript);
        if (surface === "pos") void send(transcript);
      }
    };
    recognition.onerror = () => {
      setListening(false);
      setAttachmentError(t("ai.errors.speechError"));
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  async function send(text: string) {
    const q = text.trim();
    if ((!q && attachments.length === 0) || busy) return;
    if (attachments.some((item) => item.status === "uploading")) {
      setAttachmentError(t("ai.errors.attachmentUploading"));
      return;
    }
    if (attachments.some((item) => item.status === "failed")) {
      setAttachmentError(t("ai.errors.attachmentFailed"));
      return;
    }
    const outgoingAttachments = attachments;
    const attachmentPrompt = q || t("ai.composer.analyzeAttachmentPrompt");
    const actionText = activePreset ? actionPromptForPreset(activePreset, attachmentPrompt) : attachmentPrompt;
    const prompt = outgoingAttachments.length
      ? `${actionText}\n\n[${outgoingAttachments.length} attachment(s): ${outgoingAttachments.map((item) => item.name).join(", ")}]`
      : actionText;
    setMsgs((m) => [...m, { role: "user", text: q || t("ai.composer.attachmentOnlyMessage"), attachments: outgoingAttachments }]);
    setInput("");
    setAttachments([]);
    setBusy(true);
    try {
      const data = await postJson("/api/mobile/ai/assistant", {
        prompt,
        surface,
        attachments: outgoingAttachments.map(({ id, bucket, path, name, mimeType, size, kind, signedUrl }) => ({
          id,
          bucket,
          path,
          name,
          mimeType,
          size,
          kind,
          signedUrl,
        })),
      }) as AssistantResponse;
      if (data.aiUsage) setUsage(data.aiUsage);
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          text: data.text,
          state: data.state,
          preview: data.actionPreview,
        },
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          text: e instanceof Error ? e.message : t("errors.serverError"),
          state: "failed",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function resolvePreview(index: number, event: "confirmed" | "cancelled") {
    const msg = msgs[index];
    if (!msg.preview || busy) return;
    const preview = msg.preview;
    setBusy(true);
    try {
      const result = await postJson("/api/mobile/ai/actions", {
        event,
        prompt: preview.action.payload.prompt,
        actionPreview: preview,
        surface,
      }) as {
        message?: string;
        record?: Msg["record"];
        status?: PreviewResolutionState;
      };
      const confirmedPosDraft = event === "confirmed" && isPosCartPreview(preview) && posDraftItems(preview).length > 0;
      if (confirmedPosDraft) {
        storePosDraft(preview);
        if (surface === "pos") {
          dispatchPosDraft(preview);
        }
      }
      setMsgs((m) => m.map((item, i) => i === index
        ? {
            ...item,
            state: result.status ?? event,
            result: result.message ?? (event === "confirmed" ? t("ai.preview.confirmedResult") : t("ai.preview.cancelledResult")),
            record: confirmedPosDraft ? recordWithPosDraftHref(result.record, preview) : result.record,
          }
        : item));
    } catch (e) {
      setMsgs((m) => m.map((item, i) => i === index
        ? { ...item, state: "failed", result: e instanceof Error ? e.message : t("errors.serverError") }
        : item));
    } finally {
      setBusy(false);
    }
  }

  function clearLocalMessages() {
    setMsgs([]);
    if (typeof window !== "undefined") window.localStorage.removeItem(chatHistoryKey);
  }

  async function clearMessages() {
    clearLocalMessages();
    if (sessionId) {
      await putJson("/api/mobile/ai/sessions", {
        sessionId,
        surface,
        title: sessions.find((item) => item.id === sessionId)?.title ?? defaultSessionTitle,
        messages: [],
      }).catch(() => {});
      setSessions((current) => current.map((item) => item.id === sessionId ? { ...item, messageCount: 0 } : item));
    }
  }

  async function deleteSession() {
    if (!sessionId || busy) return;
    const currentId = sessionId;
    clearLocalMessages();
    if (sessionId) {
      await deleteJson(`/api/mobile/ai/sessions?sessionId=${sessionId}`).catch(() => {});
      setSessionId(null);
      setActivePresetId(null);
      const map = readSessionPresetMap(sessionPresetKey, actionPresets);
      delete map[currentId];
      writeSessionPresetMap(sessionPresetKey, map);
      setSessions((current) => current.filter((item) => item.id !== currentId));
    }
  }

  async function newSession(preset?: AssistantActionPreset | null) {
    setMsgs([]);
    setInput("");
    setActivePresetId(preset?.id ?? null);
    const data = await postJson("/api/mobile/ai/sessions", { surface, title: preset?.sessionTitle ?? defaultSessionTitle });
    const id = (data as { session?: { id?: unknown } }).session?.id;
    if (typeof id === "string") {
      setSessionId(id);
      const map = readSessionPresetMap(sessionPresetKey, actionPresets);
      if (preset) {
        map[id] = preset.id;
      } else {
        delete map[id];
      }
      writeSessionPresetMap(sessionPresetKey, map);
    }
    await refreshSessions(false).catch(() => {});
  }

  async function startActionSession(preset: AssistantActionPreset) {
    await newSession(preset);
  }

  async function switchSession(id: string) {
    if (!id || id === sessionId || busy) return;
    await loadServerSession(id);
  }

  async function renameSession(title: string) {
    if (!sessionId) return;
    const nextTitle = title.trim().slice(0, 120);
    if (!nextTitle) return;
    await putJson("/api/mobile/ai/sessions", {
      sessionId,
      surface,
      title: nextTitle,
      messages: sanitizeMessagesForStorage(msgs),
    }).catch(() => {});
    setSessions((items) => items.map((item) => item.id === sessionId ? { ...item, title: nextTitle } : item));
  }

  return {
    input,
    setInput,
    attachments,
    attachmentError,
    fileRef,
    addFiles,
    removeAttachment,
    handlePaste,
    msgs,
    sessions,
    sessionId,
    busy,
    listening,
    surface,
    usage,
    activePreset,
    actionPresets,
    suggestions,
    suggestionGroups,
    send,
    startVoiceInput,
    newSession,
    startActionSession,
    switchSession,
    renameSession,
    deleteSession,
    resolvePreview,
    clearMessages,
  };
}
