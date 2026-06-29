"use client";

import { type ClipboardEvent, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileUp, Loader2, Paperclip, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AiActionPreview } from "@/lib/ai/actions";
import { AttachmentPill } from "@/components/ai-assistant/attachment-pill";
import { postJson, uploadAiAttachment } from "@/components/ai-assistant/api";
import type { AssistantResponse, AssistantSurface, ComposerAttachment } from "@/components/ai-assistant/types";
import { ACCEPTED_ATTACHMENT_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, attachmentKind } from "@/components/ai-assistant/utils";
import { AiQuickActionPreviewPanel } from "./ai-quick-action-preview-panel";
import type { AiQuickActionApplyMode, AiQuickActionPreset } from "./types";
import { isPreviewApplicable, quickActionPrompt } from "./utils";

const ACCEPTED_FILE_INPUT_TYPES = Array.from(ACCEPTED_ATTACHMENT_TYPES).join(",");

function attachmentPayload(attachment: ComposerAttachment) {
  const { id, bucket, path, name, mimeType, size, kind, signedUrl } = attachment;
  return { id, bucket, path, name, mimeType, size, kind, signedUrl };
}

export function AiQuickActionModal({
  open,
  title,
  description,
  placeholder,
  submitLabel,
  applyLabel,
  preset,
  surface,
  acceptedIntents,
  hasExistingData,
  existingDataLabel,
  onClose,
  onApply,
}: {
  open: boolean;
  title: string;
  description: string;
  placeholder: string;
  submitLabel: string;
  applyLabel: string;
  preset: AiQuickActionPreset;
  surface: AssistantSurface;
  acceptedIntents: string[];
  hasExistingData: boolean;
  existingDataLabel: string;
  onClose: () => void;
  onApply: (preview: AiActionPreview, mode: AiQuickActionApplyMode) => Promise<void> | void;
}) {
  const t = useTranslations();
  const fileRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState<AiQuickActionApplyMode | null>(null);
  const [error, setError] = useState("");
  const [responseText, setResponseText] = useState("");
  const [preview, setPreview] = useState<AiActionPreview | null>(null);

  if (!open) return null;

  function addFiles(files: FileList | File[]) {
    const next: ComposerAttachment[] = [];
    setAttachmentError("");
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
      void uploadAiAttachment(file, surface)
        .then((uploaded) => {
          setAttachments((current) => current.map((item) => item.localId === localId
            ? { ...item, ...uploaded, localId, previewUrl: item.previewUrl, status: "uploaded" }
            : item));
        })
        .catch((uploadError) => {
          setAttachments((current) => current.map((item) => item.localId === localId
            ? { ...item, status: "failed", error: uploadError instanceof Error ? uploadError.message : t("ai.errors.uploadFailed") }
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

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  }

  async function submit() {
    const readyAttachments = attachments.filter((item) => item.status !== "failed");
    if ((!input.trim() && readyAttachments.length === 0) || busy) return;
    if (attachments.some((item) => item.status === "uploading")) {
      setAttachmentError(t("ai.errors.attachmentUploading"));
      return;
    }
    if (attachments.some((item) => item.status === "failed")) {
      setAttachmentError(t("ai.errors.attachmentFailed"));
      return;
    }
    setBusy(true);
    setError("");
    setResponseText("");
    setPreview(null);
    try {
      const effectivePreset = preset === "pos_voice_cart_draft" && readyAttachments.length > 0
        ? "pos_image_cart_draft"
        : preset;
      const prompt = quickActionPrompt({
        preset: effectivePreset,
        userText: input,
        attachmentCount: readyAttachments.length,
        attachmentNames: readyAttachments.map((item) => item.name),
      });
      const data = await postJson("/api/mobile/ai/assistant", {
        prompt,
        surface,
        attachments: readyAttachments.map(attachmentPayload),
      }) as AssistantResponse;
      setResponseText(data.text);
      setPreview(data.actionPreview ?? null);
      if (!data.actionPreview) setError(data.text || t("aiQuick.errors.noPreview"));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("errors.serverError"));
    } finally {
      setBusy(false);
    }
  }

  async function apply(mode: AiQuickActionApplyMode) {
    if (!preview || applyBusy) return;
    setApplyBusy(mode);
    setError("");
    try {
      await onApply(preview, mode);
      onClose();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : t("errors.serverError"));
    } finally {
      setApplyBusy(null);
    }
  }

  const hasUploadingAttachment = attachments.some((item) => item.status === "uploading");
  const hasFailedAttachment = attachments.some((item) => item.status === "failed");
  const canSubmit = (input.trim().length > 0 || attachments.length > 0) && !busy && !hasUploadingAttachment && !hasFailedAttachment;
  const canApply = preview ? isPreviewApplicable(preview, acceptedIntents) : false;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-3 py-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy && !applyBusy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-border bg-surface shadow-e2"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border-soft px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <Sparkles className="h-4 w-4 text-primary-600" />
              <span className="truncate">{title}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
          <Button type="button" variant="outline" size="iconSm" onClick={onClose} disabled={busy || Boolean(applyBusy)} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="border-b border-border-soft bg-surface-2 px-4 py-3">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={3}
            className="resize-none bg-surface"
            disabled={busy || Boolean(applyBusy)}
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPTED_FILE_INPUT_TYPES}
                onChange={(event) => {
                  if (event.target.files) addFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
                className="hidden"
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy || Boolean(applyBusy)} className="gap-1.5 text-xs">
                <Paperclip className="h-3.5 w-3.5" />
                {t("aiQuick.attach")}
              </Button>
              {attachments.map((attachment) => (
                <AttachmentPill
                  key={attachment.localId ?? attachment.id}
                  attachment={attachment}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
            </div>
            <Button type="button" onClick={submit} loading={busy} disabled={!canSubmit} size="sm" className="gap-1.5">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {submitLabel}
            </Button>
          </div>
          {attachmentError && <div className="mt-2 rounded-lg border border-er/20 bg-er-soft px-3 py-2 text-xs font-semibold text-er">{attachmentError}</div>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {!preview && !busy && !error && (
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border bg-canvas/50 px-4 text-center">
              <div>
                <FileUp className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                <div className="text-sm font-bold text-slate-600 dark:text-slate-300">{t("aiQuick.emptyTitle")}</div>
                <div className="mt-1 text-xs text-slate-400">{t("aiQuick.emptyDescription")}</div>
              </div>
            </div>
          )}
          {busy && (
            <div className="grid min-h-40 place-items-center rounded-xl border border-primary-100 bg-primary-50/70 px-4 text-center text-primary-700">
              <div>
                <Loader2 className="mx-auto mb-2 h-7 w-7 animate-spin" />
                <div className="text-sm font-bold">{t("aiQuick.processing")}</div>
              </div>
            </div>
          )}
          {responseText && <div className="mb-3 rounded-xl border border-border-soft bg-surface-2 px-3 py-2 text-xs font-semibold text-slate-500">{responseText}</div>}
          {preview && <AiQuickActionPreviewPanel preview={preview} />}
          {error && <div className="mt-3 rounded-xl border border-er/20 bg-er-soft px-3 py-2 text-sm font-semibold text-er">{error}</div>}
        </div>

        <footer className="flex flex-col gap-2 border-t border-border-soft bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-semibold text-slate-400">
            {hasExistingData ? existingDataLabel : t("aiQuick.noExistingData")}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy || Boolean(applyBusy)} size="sm">
              {t("common.cancel")}
            </Button>
            {hasExistingData && (
              <Button type="button" variant="outline" onClick={() => void apply("replace")} loading={applyBusy === "replace"} disabled={!canApply || busy} size="sm" className="text-warn hover:bg-warn-soft">
                {t("aiQuick.replace")}
              </Button>
            )}
            <Button type="button" onClick={() => void apply("merge")} loading={applyBusy === "merge"} disabled={!canApply || busy} size="sm" className={cn(!canApply && "opacity-60")}>
              {hasExistingData ? t("aiQuick.merge") : applyLabel}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
