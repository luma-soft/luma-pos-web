"use client";

import { type ClipboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Eraser,
  FileText,
  ImageIcon,
  Info,
  Maximize2,
  MessageSquare,
  Mic,
  Minus,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiActionPreview, AiAssistantState } from "@/lib/ai/actions";

type PreviewResolutionState = AiAssistantState | "confirmed" | "cancelled";
type AssistantSurface = "web" | "pos";

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type Msg = {
  role: "user" | "assistant";
  text: string;
  attachments?: ComposerAttachment[];
  state?: PreviewResolutionState;
  preview?: AiActionPreview;
  result?: string;
  record?: {
    type: string;
    id: string;
    code: string;
    href: string;
  };
};

type AssistantResponse = {
  text: string;
  state?: AiAssistantState;
  actionPreview?: AiActionPreview;
  aiUsage?: AiUsageStatus;
};

type AiUsageStatus = {
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

type AiSessionSummary = {
  id: string;
  title: string;
  surface: AssistantSurface;
  messageCount?: number;
};

function isPosCartPreview(preview: AiActionPreview) {
  return preview.intent === "pos_voice_cart_draft" || preview.intent === "pos_image_cart_draft";
}

function strongConfirmationText(preview: AiActionPreview) {
  if (preview.intent === "apply_price_formula") {
    return "Thao tác này có thể đổi giá hàng loạt. Hãy kiểm tra bảng giá và số lượng sản phẩm bị ảnh hưởng trước khi xác nhận.";
  }
  if (preview.intent === "record_invoice_payment") {
    return "Thao tác này ghi nhận dòng tiền và trạng thái thanh toán hóa đơn. Sau khi xác nhận cần đối soát sổ quỹ.";
  }
  if (preview.intent === "cancel_invoice") {
    return "Thao tác này có thể hủy chứng từ, hoàn tồn kho, đảo công nợ và ảnh hưởng báo cáo doanh thu.";
  }
  if (preview.intent === "create_return_refund") {
    return "Thao tác này có thể tạo trả hàng/hoàn tiền, thay đổi tồn kho và ghi nhận dòng tiền.";
  }
  if (preview.intent === "send_einvoice") {
    return "Thao tác này có thể gửi dữ liệu hóa đơn điện tử ra nhà cung cấp và phát sinh trạng thái pháp lý.";
  }
  if (preview.intent === "create_cashbook_entry") {
    return "Thao tác này tạo giao dịch sổ quỹ. Hãy kiểm tra số tiền, loại thu/chi và ghi chú.";
  }
  if (preview.intent === "convert_quote_to_order") {
    return "Thao tác này chuyển báo giá thành đơn bán và có thể ảnh hưởng tồn kho.";
  }
  if (preview.intent === "create_order") {
    return "Thao tác này tạo đơn bán nháp từ AI. Hãy kiểm tra khách hàng, dòng hàng và tổng tiền.";
  }
  return "Đây là thao tác có ảnh hưởng nghiệp vụ. Hãy kiểm tra preview, cảnh báo và bản ghi liên quan trước khi xác nhận.";
}

type FabPosition = {
  x: number;
  y: number;
};

type FabDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

type ComposerAttachment = {
  id: string;
  localId?: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "document";
  previewUrl?: string;
  bucket?: string;
  path?: string;
  signedUrl?: string;
  status?: "uploading" | "uploaded" | "failed";
  error?: string;
};

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const FAB_MARGIN = 12;
const FAB_MOVE_THRESHOLD = 10;
const CHAT_HISTORY_LIMIT = 80;
const ACCEPTED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function clampFabPosition(position: FabPosition, size: number): FabPosition {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(Math.max(FAB_MARGIN, position.x), Math.max(FAB_MARGIN, window.innerWidth - size - FAB_MARGIN)),
    y: Math.min(Math.max(FAB_MARGIN, position.y), Math.max(FAB_MARGIN, window.innerHeight - size - FAB_MARGIN)),
  };
}

function readFabPosition(key: string, size: number): FabPosition | null {
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

function saveFabPosition(key: string, position: FabPosition) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(position));
}

function sanitizeAttachmentForStorage(attachment: ComposerAttachment): ComposerAttachment {
  const sanitized = { ...attachment };
  delete sanitized.previewUrl;
  delete sanitized.localId;
  return {
    ...sanitized,
    status: attachment.status === "uploading" ? "uploaded" : attachment.status,
  };
}

function sanitizeMessagesForStorage(messages: Msg[]): Msg[] {
  return messages.slice(-CHAT_HISTORY_LIMIT).map((message) => ({
    ...message,
    attachments: message.attachments?.map(sanitizeAttachmentForStorage),
  }));
}

function readChatHistory(key: string): Msg[] {
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

function attachmentKind(type: string): ComposerAttachment["kind"] | null {
  if (type.startsWith("image/") && ACCEPTED_ATTACHMENT_TYPES.has(type)) return "image";
  if (ACCEPTED_ATTACHMENT_TYPES.has(type)) return "document";
  return null;
}

function fileSizeText(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

async function putJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

async function deleteJson(path: string) {
  const res = await fetch(path, { method: "DELETE" });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

async function getJson(path: string) {
  const res = await fetch(path);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

function serverMessagesToChat(messages: unknown[]): Msg[] {
  return messages.map((item) => {
    const msg = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      role: msg.role === "assistant" ? "assistant" : "user",
      text: typeof msg.content === "string" ? msg.content : "",
      attachments: Array.isArray(msg.attachments) ? msg.attachments as ComposerAttachment[] : undefined,
      state: typeof msg.state === "string" ? msg.state as PreviewResolutionState : undefined,
      preview: msg.preview && typeof msg.preview === "object" ? msg.preview as AiActionPreview : undefined,
      result: typeof msg.result === "string" ? msg.result : undefined,
      record: msg.record && typeof msg.record === "object" ? msg.record as Msg["record"] : undefined,
    } satisfies Msg;
  }).filter((msg) => msg.text);
}

function serverSessions(value: unknown): AiSessionSummary[] {
  const sessions = value && typeof value === "object" && Array.isArray((value as { sessions?: unknown }).sessions)
    ? (value as { sessions: unknown[] }).sessions
    : [];
  return sessions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string") return [];
    return [{
      id: raw.id,
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "AI Assistant",
      surface: raw.surface === "pos" ? "pos" : "web",
      messageCount: typeof raw.messageCount === "number" ? raw.messageCount : undefined,
    }];
  });
}

async function uploadAiAttachment(file: File): Promise<ComposerAttachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("surface", "web");
  const res = await fetch("/api/mobile/ai/attachments", {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json.data as ComposerAttachment;
}

function useAssistantState(surface: AssistantSurface) {
  const t = useTranslations();
  const chatHistoryKey = `luma-ai-chat-history:${surface}`;
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>(() => readChatHistory(chatHistoryKey));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [serverHydrated, setServerHydrated] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.localStorage.setItem(chatHistoryKey, JSON.stringify(sanitizeMessagesForStorage(msgs)));
  }, [chatHistoryKey, msgs]);

  async function loadServerSession(id: string) {
    const loaded = await getJson(`/api/mobile/ai/sessions?sessionId=${id}`);
    const messages = Array.isArray((loaded as { messages?: unknown }).messages)
      ? (loaded as { messages: unknown[] }).messages
      : [];
    setSessionId(id);
    setMsgs(serverMessagesToChat(messages));
  }

  async function refreshSessions(selectLatest = false) {
    const data = await getJson(`/api/mobile/ai/sessions?surface=${surface}`);
    const next = serverSessions(data);
    setSessions(next);
    if (selectLatest && next[0]) await loadServerSession(next[0].id);
    return next;
  }

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
  }, [surface]);

  useEffect(() => {
    if (!serverHydrated) return;
    if (msgs.length === 0) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      void putJson("/api/mobile/ai/sessions", {
        sessionId,
        surface,
        title: msgs.find((msg) => msg.role === "user")?.text.slice(0, 80) || "AI Assistant",
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
  }, [msgs, serverHydrated, sessionId, surface]);

  useEffect(() => {
    let cancelled = false;
    getJson("/api/mobile/ai/usage")
      .then((data) => { if (!cancelled) setUsage(data as AiUsageStatus); })
      .catch(() => { if (!cancelled) setUsage(null); });
    return () => { cancelled = true; };
  }, []);

  const suggestions = surface === "pos"
    ? [
        "2 cà phê Robusta, 1 bánh mì thịt",
        "Tìm sản phẩm sắp hết trong giỏ",
        t("ai.q.lowStock"),
        t("ai.q.todaySales"),
      ]
    : [
        t("ai.q.todaySales"),
        t("ai.q.topSellers"),
        t("ai.q.lowStock"),
        t("ai.q.restockToday"),
        "Nhập 20 thùng cà phê Robusta vào kho chính",
        "Đặt giá SKU A là 120.000",
      ];

  function addFiles(files: FileList | File[]) {
    const next: ComposerAttachment[] = [];
    setAttachmentError(null);
    for (const file of Array.from(files)) {
      if (attachments.length + next.length >= MAX_ATTACHMENTS) {
        setAttachmentError(`Chỉ đính kèm tối đa ${MAX_ATTACHMENTS} file mỗi tin nhắn.`);
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentError(`${file.name} vượt quá giới hạn 10 MB.`);
        continue;
      }
      const kind = attachmentKind(file.type);
      if (!kind) {
        setAttachmentError(`${file.name} chưa được hỗ trợ. Hỗ trợ PNG, JPG, WebP, PDF, CSV, XLSX.`);
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
            ? { ...item, status: "failed", error: error instanceof Error ? error.message : "Upload failed" }
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
      setAttachmentError("Trình duyệt hiện chưa hỗ trợ speech-to-text.");
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
      setAttachmentError("Không nghe được giọng nói. Hãy thử lại hoặc nhập tay.");
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  async function send(text: string) {
    const q = text.trim();
    if ((!q && attachments.length === 0) || busy) return;
    if (attachments.some((item) => item.status === "uploading")) {
      setAttachmentError("File vẫn đang upload, chờ thêm một chút rồi gửi lại.");
      return;
    }
    if (attachments.some((item) => item.status === "failed")) {
      setAttachmentError("Có file upload lỗi. Hãy xóa file lỗi hoặc thử attach lại.");
      return;
    }
    const outgoingAttachments = attachments;
    const prompt = outgoingAttachments.length
      ? `${q || "Phân tích file đính kèm"}\n\n[${outgoingAttachments.length} attachment(s): ${outgoingAttachments.map((item) => item.name).join(", ")}]`
      : q;
    setMsgs((m) => [...m, { role: "user", text: q || "File đính kèm", attachments: outgoingAttachments }]);
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
    setBusy(true);
    try {
      const result = await postJson("/api/mobile/ai/actions", {
        event,
        prompt: msg.preview.action.payload.prompt,
        actionPreview: msg.preview,
        surface,
      }) as {
        message?: string;
        record?: Msg["record"];
        status?: PreviewResolutionState;
      };
      if (event === "confirmed" && surface === "pos" && isPosCartPreview(msg.preview)) {
        window.dispatchEvent(new CustomEvent("luma:pos-ai-cart-draft", {
          detail: {
            previewId: msg.preview.id,
            intent: msg.preview.intent,
            items: msg.preview.action.payload.items,
          },
        }));
      }
      setMsgs((m) => m.map((item, i) => i === index
        ? {
            ...item,
            state: result.status ?? event,
            result: result.message ?? (event === "confirmed" ? "Confirmed" : "Cancelled"),
            record: result.record,
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
        title: sessions.find((item) => item.id === sessionId)?.title ?? "AI Assistant",
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
      setSessions((current) => current.filter((item) => item.id !== currentId));
    }
  }

  async function newSession() {
    setMsgs([]);
    setInput("");
    const data = await postJson("/api/mobile/ai/sessions", { surface, title: "AI Assistant" });
    const id = (data as { session?: { id?: unknown } }).session?.id;
    if (typeof id === "string") setSessionId(id);
    await refreshSessions(false).catch(() => {});
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
    suggestions,
    send,
    startVoiceInput,
    newSession,
    switchSession,
    renameSession,
    deleteSession,
    resolvePreview,
    clearMessages,
  };
}

export function AssistantWorkspace() {
  const t = useTranslations();
  const assistant = useAssistantState("web");

  return (
    <div className="w-full flex h-[calc(100dvh-9.5rem)] min-h-0 flex-col overflow-hidden">
      <div className="flex items-start gap-2 mb-4 px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-card text-[12px] text-in">
        <Info className="w-4 h-4 shrink-0 mt-px" />
        <span>{t("ai.actionNotice")}</span>
      </div>

      <AssistantChatSurface
        assistant={assistant}
        mode="workspace"
        emptyText={t("ai.assistantEmpty")}
        placeholder={t("ai.askPlaceholder")}
      />
    </div>
  );
}

export function AiAssistantLauncher({ surface = "web" }: { surface?: AssistantSurface }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const fabSize = 56;
  const storageKey = `luma-ai-fab-position:${surface}`;
  const [fabPosition, setFabPosition] = useState<FabPosition | null>(() => readFabPosition(storageKey, fabSize));
  const dragRef = useRef<FabDrag | null>(null);
  const suppressClickRef = useRef(false);
  const assistant = useAssistantState(surface);
  const isPos = surface === "pos";

  if (surface === "web" && pathname?.startsWith("/ai")) {
    return null;
  }

  function openAssistant() {
    setOpen(true);
    setMinimized(false);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < FAB_MOVE_THRESHOLD) return;
    drag.moved = true;
    setFabPosition(clampFabPosition({ x: drag.originX + dx, y: drag.originY + dy }, fabSize));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
      openAssistant();
      return;
    }
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    const rect = event.currentTarget.getBoundingClientRect();
    saveFabPosition(storageKey, clampFabPosition({ x: rect.left, y: rect.top }, fabSize));
  }

  function cancelDrag() {
    dragRef.current = null;
  }

  if (open && !minimized) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="lg:hidden fixed inset-0 z-[54] bg-slate-950/30"
          aria-label={t("common.close")}
        />
        <section
          aria-label={t("ai.launcherTitle")}
          className={cn(
            "fixed z-[55] bg-surface border border-border shadow-e2 overflow-hidden flex flex-col",
            "inset-x-2 bottom-2 h-[min(85dvh,680px)] rounded-t-2xl rounded-b-card",
            "lg:inset-auto lg:top-4 lg:right-4 lg:bottom-4 lg:w-[430px] lg:max-w-[calc(100vw-2rem)] lg:rounded-card",
            isPos && "lg:top-16 lg:bottom-4"
          )}
        >
          <AssistantHeader
            surface={surface}
            onMinimize={() => setMinimized(true)}
            onClose={() => setOpen(false)}
          />
          <AssistantChatSurface
            assistant={assistant}
            mode="launcher"
            emptyText={isPos ? t("ai.posEmpty") : t("ai.assistantEmpty")}
            placeholder={isPos ? t("ai.posPlaceholder") : t("ai.askPlaceholder")}
          />
        </section>
      </>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      onClick={() => {
        if (suppressClickRef.current) return;
        openAssistant();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openAssistant();
        }
      }}
      style={fabPosition ? { left: fabPosition.x, top: fabPosition.y, right: "auto", bottom: "auto" } : undefined}
      className={cn(
        "fixed z-[45] h-13 w-13 lg:h-14 lg:w-14 rounded-[18px] bg-primary-600 text-white shadow-e2 grid place-items-center touch-none cursor-grab select-none active:cursor-grabbing",
        "hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        !fabPosition && (isPos
          ? "left-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] lg:left-auto lg:right-5 lg:bottom-5"
          : "right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:right-5 lg:bottom-5")
      )}
      aria-label={t("ai.launcherTitle")}
      title={t("ai.launcherTitle")}
    >
      <Sparkles className="w-5 h-5" />
    </button>
  );
}

function AssistantHeader({
  surface,
  onMinimize,
  onClose,
}: {
  surface: AssistantSurface;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const isPos = surface === "pos";

  return (
    <div className="min-h-14 px-3.5 py-2.5 border-b border-border flex items-center justify-between gap-3 shrink-0">
      <div className="min-w-0 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-950/50 border border-primary-200 dark:border-primary-900 text-primary-700 dark:text-primary-300 grid place-items-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{isPos ? t("ai.posTitle") : t("ai.launcherTitle")}</div>
          <div className="text-[10.5px] font-semibold text-primary-600 truncate">{t("ai.launcherStatus")}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isPos && (
          <a
            href="/ai?tab=assistant"
            className="hidden sm:grid w-8 h-8 place-items-center rounded-lg border border-border text-slate-500 hover:bg-surface-2"
            title={t("ai.openWorkspace")}
          >
            <Maximize2 className="w-4 h-4" />
          </a>
        )}
        <button
          type="button"
          onClick={onMinimize}
          className="w-8 h-8 grid place-items-center rounded-lg border border-border text-slate-500 hover:bg-surface-2"
          title={t("ai.minimize")}
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 grid place-items-center rounded-lg border border-border text-slate-500 hover:bg-surface-2"
          title={t("common.close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function AssistantChatSurface({
  assistant,
  mode,
  emptyText,
  placeholder,
}: {
  assistant: ReturnType<typeof useAssistantState>;
  mode: "workspace" | "launcher";
  emptyText: string;
  placeholder: string;
}) {
  const {
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
    suggestions,
    send,
    startVoiceInput,
    newSession,
    switchSession,
    renameSession,
    deleteSession,
    resolvePreview,
    clearMessages,
  } = assistant;
  const compact = mode === "launcher";
  const hasUploadingAttachment = attachments.some((item) => item.status === "uploading");
  const hasFailedAttachment = attachments.some((item) => item.status === "failed");
  const sendDisabled = busy || hasUploadingAttachment || hasFailedAttachment || Boolean(usage?.exhausted);
  const activeSession = sessions.find((session) => session.id === sessionId) ?? null;
  const [sessionDialog, setSessionDialog] = useState<"rename" | "delete" | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, compact ? 128 : 160)}px`;
  }, [compact, input]);

  function openRenameDialog() {
    if (!sessionId) return;
    setSessionTitleDraft(activeSession?.title ?? "AI Assistant");
    setSessionDialog("rename");
  }

  function openDeleteDialog() {
    if (!sessionId) return;
    setSessionTitleDraft(activeSession?.title ?? "AI Assistant");
    setSessionDialog("delete");
  }

  async function submitRenameSession() {
    const title = sessionTitleDraft.trim();
    if (!title) return;
    await renameSession(title);
    setSessionDialog(null);
  }

  async function confirmDeleteSession() {
    await deleteSession();
    setSessionDialog(null);
  }

  return (
    <div className={cn(
      "bg-surface border border-border rounded-card shadow-e1 flex flex-col min-h-0 overflow-hidden",
      compact ? "border-0 rounded-none shadow-none flex-1" : "flex-1 h-full"
    )}>
      {(sessions.length > 0 || sessionId) && (
        <div className={cn(
          "shrink-0 flex items-center gap-2 border-b border-border-soft bg-surface",
          compact ? "px-3 py-2" : "px-4 py-2"
        )}>
          <select
            value={sessionId ?? ""}
            onChange={(event) => void switchSession(event.target.value)}
            disabled={busy}
            className="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:text-slate-300"
            aria-label="Chọn cuộc chat AI"
          >
            {!sessionId && <option value="">Cuộc chat mới</option>}
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}{typeof session.messageCount === "number" ? ` (${session.messageCount})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void newSession()}
            disabled={busy}
            className="h-8 w-8 grid place-items-center rounded-lg border border-border text-slate-500 hover:bg-surface-2 disabled:opacity-50"
            title="Tạo cuộc chat mới"
            aria-label="Tạo cuộc chat mới"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={openRenameDialog}
            disabled={busy || !sessionId}
            className="h-8 w-8 grid place-items-center rounded-lg border border-border text-slate-500 hover:bg-surface-2 disabled:opacity-50"
            title="Đổi tên cuộc chat"
            aria-label="Đổi tên cuộc chat"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void clearMessages()}
            disabled={busy || !sessionId}
            className="h-8 w-8 grid place-items-center rounded-lg border border-border text-slate-500 hover:bg-surface-2 disabled:opacity-50"
            title="Xóa tin nhắn trong cuộc chat"
            aria-label="Xóa tin nhắn trong cuộc chat"
          >
            <Eraser className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={openDeleteDialog}
            disabled={busy || !sessionId}
            className="h-8 w-8 grid place-items-center rounded-lg border border-border text-slate-500 hover:bg-er-soft hover:text-er disabled:opacity-50"
            title="Xóa cuộc chat"
            aria-label="Xóa cuộc chat"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
      {sessionDialog && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSessionDialog(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-session-dialog-title"
            className="w-full max-w-sm rounded-card border border-border bg-surface shadow-e2 overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border-soft px-4 py-3">
              <div className="min-w-0">
                <div id="ai-session-dialog-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {sessionDialog === "rename" ? "Đổi tên cuộc chat" : "Xóa cuộc chat"}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {sessionDialog === "rename"
                    ? "Tên mới sẽ được lưu vào lịch sử chat AI."
                    : "Cuộc chat và tin nhắn sẽ bị ẩn khỏi danh sách lịch sử."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSessionDialog(null)}
                className="h-8 w-8 shrink-0 grid place-items-center rounded-lg border border-border text-slate-500 hover:bg-surface-2"
                aria-label="Đóng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-4">
              {sessionDialog === "rename" ? (
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Tên cuộc chat</span>
                  <input
                    autoFocus
                    value={sessionTitleDraft}
                    onChange={(event) => setSessionTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitRenameSession();
                      if (event.key === "Escape") setSessionDialog(null);
                    }}
                    maxLength={120}
                    className="mt-1.5 w-full rounded-xl border border-border bg-canvas px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-primary-500 dark:text-slate-200"
                  />
                </label>
              ) : (
                <div className="rounded-xl border border-er/20 bg-er-soft px-3 py-2.5 text-sm font-semibold text-er">
                  Xóa "{sessionTitleDraft || "AI Assistant"}"? Thao tác này không ảnh hưởng audit log hoặc dữ liệu nghiệp vụ đã tạo.
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border-soft bg-canvas px-4 py-3">
              <button
                type="button"
                onClick={() => setSessionDialog(null)}
                className="rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-bold text-slate-500 hover:bg-surface-2"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => sessionDialog === "rename" ? void submitRenameSession() : void confirmDeleteSession()}
                disabled={busy || (sessionDialog === "rename" && !sessionTitleDraft.trim())}
                className={cn(
                  "rounded-xl px-3.5 py-2 text-sm font-bold text-white disabled:opacity-50",
                  sessionDialog === "delete" ? "bg-er hover:brightness-95" : "bg-primary-600 hover:brightness-105",
                )}
              >
                {sessionDialog === "rename" ? "Lưu" : "Xóa"}
              </button>
            </div>
          </div>
        </div>
      )}
      {msgs.length > 0 && (
        <div className={cn(
          "shrink-0 flex items-center justify-between gap-3 border-b border-border-soft bg-surface",
          compact ? "px-3 py-2" : "px-4 py-2"
        )}>
          {usage ? (
            <div className={cn(
              "text-[11px] font-semibold",
              usage.exhausted ? "text-er" : usage.remaining <= Math.max(5, usage.limit * 0.1) ? "text-warn" : "text-slate-400"
            )}>
              AI còn {usage.remaining}/{usage.limit} · {usage.totalTokens.toLocaleString("vi-VN")} tokens
            </div>
          ) : <span />}
          <button
            type="button"
            onClick={() => void clearMessages()}
            disabled={busy}
            className="text-[11px] font-semibold text-slate-400 hover:text-er disabled:opacity-50"
          >
            Xóa tin nhắn
          </button>
        </div>
      )}
      {msgs.length === 0 && usage && (
        <div className={cn(
          "shrink-0 border-b border-border-soft bg-surface text-[11px] font-semibold",
          compact ? "px-3 py-2" : "px-4 py-2",
          usage.exhausted ? "text-er" : "text-slate-400"
        )}>
          AI còn {usage.remaining}/{usage.limit} lượt trong tháng {usage.period} · {usage.totalTokens.toLocaleString("vi-VN")} tokens · ~${usage.estimatedCostUsd.toFixed(4)}
        </div>
      )}
      <div className={cn(
        "min-h-0 flex-1 overflow-y-auto flex flex-col gap-3 bg-canvas/50",
        compact ? "p-3" : "p-4"
      )}>
        {msgs.length === 0 ? (
          <div className="m-auto text-center text-slate-400 px-4">
            {compact ? (
              <MessageSquare className="w-9 h-9 mx-auto mb-3 opacity-60" />
            ) : (
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-60" />
            )}
            <p className="text-sm font-medium">{emptyText}</p>
          </div>
        ) : msgs.map((m, i) => (
          <div key={`${m.role}-${i}`} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
            <div className={cn(
              "px-3.5 py-2 rounded-2xl text-sm leading-relaxed space-y-2",
              compact ? "max-w-[88%]" : "max-w-[82%]",
              m.role === "user" ? "bg-primary-600 text-white rounded-tr-md" : "bg-surface border border-border rounded-tl-md"
            )}>
              <div>{m.text}</div>
              {m.attachments && m.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.attachments.map((attachment) => (
                    <AttachmentPill key={attachment.id} attachment={attachment} compact />
                  ))}
                </div>
              )}
            </div>
            {m.preview && (
              <PreviewCard
                preview={m.preview}
                state={m.state}
                result={m.result}
                record={m.record}
                busy={busy}
                compact={compact}
                onConfirm={() => resolvePreview(i, "confirmed")}
                onCancel={() => resolvePreview(i, "cancelled")}
                onSelectChoice={(type, candidate) => {
                  const sourcePrompt = String(m.preview?.action.payload.prompt ?? m.text);
                  const selected = `${sourcePrompt}\nChọn ${type}: ${candidate.label}${candidate.code ? ` (${candidate.code})` : ""}`;
                  void send(selected);
                }}
              />
            )}
          </div>
        ))}
        {busy && <div className="self-start text-xs text-slate-400 px-3 py-2">Đang xử lý...</div>}
      </div>

      <div className="shrink-0 bg-surface">
        {hasUploadingAttachment && (
          <div className={cn("px-3 pt-2 text-[11px] font-semibold text-slate-400", !compact && "px-4")}>
            Đang upload file, chờ xong rồi gửi.
          </div>
        )}
        {usage?.exhausted && (
          <div className={cn("px-3 pt-2 text-[11px] font-semibold text-er", !compact && "px-4")}>
            Đã hết lượt AI tháng này. Owner có thể tăng giới hạn trong Settings &gt; AI.
          </div>
        )}

        <div className={cn("px-3 pt-2 flex gap-1.5 overflow-x-auto", compact ? "shrink-0" : "flex-wrap")}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={sendDisabled}
              onClick={() => send(s)}
              className="shrink-0 px-2.5 py-1 rounded-full border border-border text-xs text-slate-600 dark:text-slate-300 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="p-3 border-t border-border mt-2">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((attachment) => (
                <AttachmentPill
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
            </div>
          )}
          {attachmentError && (
            <div className="mb-2 rounded-lg bg-er-soft px-3 py-2 text-xs font-semibold text-er">
              {attachmentError}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files ?? []);
                e.currentTarget.value = "";
              }}
            />
            <button
              disabled={busy}
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-9 h-9 grid place-items-center rounded-full border border-border bg-surface text-slate-600 hover:bg-surface-2 shrink-0 disabled:opacity-50"
              title="Đính kèm file hoặc ảnh"
              aria-label="Attach file"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            {surface === "pos" && (
              <button
                disabled={busy || listening}
                type="button"
                onClick={startVoiceInput}
                className={cn(
                  "w-9 h-9 grid place-items-center rounded-full border border-border bg-surface text-slate-600 hover:bg-surface-2 shrink-0 disabled:opacity-50",
                  listening && "border-primary-500 text-primary-600 bg-primary-50"
                )}
                title={listening ? "Đang nghe..." : "Đọc sản phẩm bằng giọng nói"}
                aria-label="Voice POS cart"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
            <textarea
              ref={composerRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={attachments.length ? "Nhập yêu cầu cho file đính kèm..." : placeholder}
              rows={1}
              className="min-h-9 max-h-32 sm:max-h-40 flex-1 min-w-0 resize-none rounded-[18px] border border-border bg-canvas px-3 py-2 text-sm leading-5 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              disabled={sendDisabled}
              type="submit"
              className="w-9 h-9 grid place-items-center rounded-full bg-primary-600 text-white shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
              title={hasUploadingAttachment ? "Đang upload file" : "Send"}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AttachmentPill({
  attachment,
  compact = false,
  onRemove,
}: {
  attachment: ComposerAttachment;
  compact?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className={cn(
      "group flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs",
      compact ? "border-white/25 bg-white/10 text-current" : "border-border bg-surface-2 text-slate-600 dark:text-slate-300"
    )}>
      {attachment.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachment.previewUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
      ) : attachment.kind === "image" ? (
        <ImageIcon className="h-4 w-4 shrink-0" />
      ) : (
        <FileText className="h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="max-w-40 truncate font-semibold">{attachment.name}</div>
        {!compact && (
          <div className={cn(
            "text-[10px] opacity-70",
            attachment.status === "failed" && "text-er opacity-100",
          )}>
            {attachment.status === "uploading"
              ? "Đang upload..."
              : attachment.status === "failed"
                ? attachment.error ?? "Upload lỗi"
                : fileSizeText(attachment.size)}
          </div>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full p-0.5 opacity-60 hover:bg-black/10 hover:opacity-100"
          aria-label={`Remove ${attachment.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function PreviewCard({
  preview,
  state,
  result,
  record,
  busy,
  compact,
  onConfirm,
  onCancel,
  onSelectChoice,
}: {
  preview: AiActionPreview;
  state?: PreviewResolutionState;
  result?: string;
  record?: Msg["record"];
  busy: boolean;
  compact?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onSelectChoice: (type: string, candidate: { label: string; code?: string; confidence?: number }) => void;
}) {
  const [strongConfirmed, setStrongConfirmed] = useState(false);
  const isConfirmed = state === "confirmed";
  const succeeded = state === "succeeded";
  const done = isConfirmed || succeeded || state === "cancelled";
  const canConfirm = preview.state === "preview" && preview.missingFields.length === 0 && (!preview.strongConfirmation || strongConfirmed);
  useEffect(() => {
    setStrongConfirmed(false);
  }, [preview.id, state]);
  return (
    <div className={cn("w-full bg-surface border border-border rounded-card shadow-e1 overflow-hidden", compact ? "max-w-full" : "max-w-2xl")}>
      <div className="p-3 border-b border-border-soft flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{preview.title}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {preview.intent} · confidence {Math.round(preview.confidence * 100)}%
          </div>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
          preview.strongConfirmation ? "bg-warn-soft text-warn" : "bg-primary-50 text-primary-700"
        )}>
          {preview.strongConfirmation ? "Strong confirm" : "Preview"}
        </span>
      </div>
      <div className="p-3 space-y-3">
        <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
          {preview.fields.map((field) => (
            <div key={field.label} className="rounded-lg bg-canvas border border-border-soft p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{field.label}</div>
              <div className={cn("text-sm font-semibold mt-0.5", field.tone === "warning" && "text-warn", field.tone === "danger" && "text-er")}>{field.value}</div>
            </div>
          ))}
        </div>
        {preview.lines.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            {preview.lines.map((line) => (
              <div key={`${line.label}-${line.value}`} className="flex items-start justify-between gap-3 p-2.5 border-b border-border-soft last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{line.label}</div>
                  {line.meta && <div className="text-[11px] text-slate-400 mt-0.5">{line.meta}</div>}
                </div>
                <div className={cn("text-sm font-mono font-bold shrink-0", line.tone === "danger" ? "text-er" : line.tone === "warning" ? "text-warn" : "text-primary-600")}>{line.value}</div>
              </div>
            ))}
          </div>
        )}
        {preview.missingFields.length > 0 && (
          <div className="rounded-lg bg-warn-soft text-warn p-2.5 text-xs font-semibold">
            Cần bổ sung: {preview.missingFields.join(", ")}
          </div>
        )}
        {preview.strongConfirmation && !done && (
          <label className="block rounded-lg border border-warn/25 bg-warn-soft p-2.5 text-xs text-warn">
            <div className="font-bold">Cần xác nhận mạnh</div>
            <div className="mt-1 leading-relaxed">{strongConfirmationText(preview)}</div>
            <div className="mt-2 flex items-start gap-2 font-semibold">
              <input
                type="checkbox"
                checked={strongConfirmed}
                onChange={(event) => setStrongConfirmed(event.target.checked)}
                disabled={busy}
                className="mt-0.5"
              />
              <span>Tôi đã kiểm tra preview và hiểu hậu quả của thao tác này.</span>
            </div>
          </label>
        )}
        {preview.warnings.map((warning) => (
          <div key={warning} className="rounded-lg bg-surface-2 p-2.5 text-xs text-slate-500">{warning}</div>
        ))}
        {preview.selections && preview.selections.length > 0 && (
          <div className="rounded-lg border border-border bg-canvas p-2.5 space-y-2">
            {preview.selections.map((selection) => (
              <div key={`${selection.type}-${selection.query}`} className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-500">
                  Chọn {selection.type}{selection.query ? ` cho "${selection.query}"` : ""}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selection.candidates.map((candidate) => (
                    <button
                      key={`${candidate.id ?? candidate.label}-${candidate.code ?? ""}`}
                      type="button"
                      disabled={busy}
                      onClick={() => onSelectChoice(selection.type, candidate)}
                      className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-surface-2 disabled:opacity-50"
                    >
                      {candidate.label}{candidate.code ? ` · ${candidate.code}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={cn("p-3 bg-surface-2 border-t border-border flex gap-2", compact ? "flex-col" : "items-center justify-between")}>
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">{result ?? "Preview đã được ghi audit."}</div>
          {record && (
            <a href={record.href} className="mt-1 block text-xs font-bold text-primary-600 hover:underline">
              Mở PO nháp {record.code}
            </a>
          )}
        </div>
        {done ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-bold", isConfirmed || succeeded ? "text-ok" : "text-slate-500")}>
            {isConfirmed || succeeded ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {state}
          </span>
        ) : (
          <div className="flex gap-2 justify-end">
            <button disabled={busy} type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border text-xs font-bold text-slate-500 disabled:opacity-50">Hủy</button>
            <button
              disabled={busy || !canConfirm}
              type="button"
              onClick={onConfirm}
              className={cn(
                "px-3 py-1.5 rounded-lg text-white text-xs font-bold disabled:opacity-50",
                preview.strongConfirmation ? "bg-warn hover:brightness-95" : "bg-primary-600"
              )}
            >
              {preview.strongConfirmation ? "Xác nhận mạnh" : "Xác nhận"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
