import type { ClipboardEvent, Dispatch, RefObject, SetStateAction } from "react";
import type { LucideIcon } from "lucide-react";
import type { AiActionPreview, AiAssistantState } from "@/lib/ai/actions";
import type { AiUsageStatus } from "@/lib/ai/usage";

export type PreviewResolutionState = AiAssistantState | "confirmed" | "cancelled";
export type AssistantSurface = "web" | "pos";

export type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

export type ComposerAttachment = {
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

export type Msg = {
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

export type AssistantResponse = {
  text: string;
  state?: AiAssistantState;
  actionPreview?: AiActionPreview;
  aiUsage?: AiUsageStatus;
};

export type AiSessionSummary = {
  id: string;
  title: string;
  surface: AssistantSurface;
  messageCount?: number;
};

export type AssistantActionPresetId = "create_invoice" | "draft_purchase_order" | "create_inventory_inbound";

export type AssistantActionPreset = {
  id: AssistantActionPresetId;
  label: string;
  sessionTitle: string;
  description: string;
  emptyText: string;
  placeholder: string;
  promptPrefix: string;
  examples: string[];
  icon: LucideIcon;
  tone: "sale" | "purchase" | "inbound";
};

export type FabPosition = {
  x: number;
  y: number;
};

export type FabDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export type AssistantController = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  attachments: ComposerAttachment[];
  attachmentError: string | null;
  fileRef: RefObject<HTMLInputElement | null>;
  addFiles: (files: FileList | File[]) => void;
  removeAttachment: (id: string) => void;
  handlePaste: (event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  msgs: Msg[];
  sessions: AiSessionSummary[];
  sessionId: string | null;
  busy: boolean;
  listening: boolean;
  surface: AssistantSurface;
  usage: AiUsageStatus | null;
  activePreset: AssistantActionPreset | null;
  actionPresets: AssistantActionPreset[];
  suggestions: string[];
  send: (text: string) => Promise<void>;
  startVoiceInput: () => void;
  newSession: (preset?: AssistantActionPreset | null) => Promise<void>;
  startActionSession: (preset: AssistantActionPreset) => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  renameSession: (title: string) => Promise<void>;
  deleteSession: () => Promise<void>;
  resolvePreview: (index: number, event: "confirmed" | "cancelled") => Promise<void>;
  clearMessages: () => Promise<void>;
};
