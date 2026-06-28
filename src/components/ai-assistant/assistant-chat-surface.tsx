"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Eraser, MessageSquare, Mic, Paperclip, Pencil, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ActionPresetButtons } from "./action-preset-buttons";
import { AttachmentPill } from "./attachment-pill";
import { PreviewCard } from "./preview-card";
import type { AssistantController } from "./types";

const ACCEPTED_FILE_INPUT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

function AssistantProcessingBubble({ compact, text }: { compact: boolean; text: string }) {
  return (
    <div className={cn("self-start", compact ? "max-w-[94%]" : "max-w-[82%]")}>
      <div className="relative overflow-hidden rounded-2xl rounded-tl-md border border-primary-100 bg-surface px-3.5 py-3 shadow-[0_12px_30px_rgba(15,118,110,0.08)]">
        <div className="absolute inset-0 -translate-x-full animate-[pulse_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary-50/80 to-transparent" />
        <div className="relative flex items-center gap-3">
          <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700">
            <span className="absolute inset-0 rounded-xl bg-primary-100/70 animate-ping" />
            <Sparkles className="relative h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold text-slate-600 dark:text-slate-200">{text}</span>
            <span className="mt-1 flex items-center gap-1.5">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="h-1.5 w-1.5 rounded-full bg-primary-500 animate-bounce"
                  style={{ animationDelay: `${index * 120}ms` }}
                />
              ))}
              <span className="ml-1 h-1 w-20 overflow-hidden rounded-full bg-primary-50">
                <span className="block h-full w-1/2 rounded-full bg-primary-400 animate-pulse" />
              </span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function AssistantChatSurface({
  assistant,
  mode,
  emptyText,
  placeholder,
}: {
  assistant: AssistantController;
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
    activePreset,
    actionPresets,
    suggestionGroups,
    send,
    startVoiceInput,
    newSession,
    startActionSession,
    switchSession,
    renameSession,
    deleteSession,
    clearMessages,
  } = assistant;
  const t = useTranslations();
  const locale = useLocale();
  const compact = mode === "launcher";
  const panelEmptyText = activePreset?.emptyText ?? emptyText;
  const composerPlaceholder = activePreset?.placeholder ?? placeholder;
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const hasUploadingAttachment = attachments.some((item) => item.status === "uploading");
  const hasFailedAttachment = attachments.some((item) => item.status === "failed");
  const composerDisabled = busy || hasUploadingAttachment || hasFailedAttachment || Boolean(usage?.exhausted);
  const hasComposerPayload = input.trim().length > 0 || attachments.length > 0;
  const sendDisabled = composerDisabled || !hasComposerPayload;
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

  function submitComposer() {
    if (!hasComposerPayload) {
      if (input.length > 0) setInput("");
      return;
    }
    void send(input);
  }

  function openRenameDialog() {
    if (!sessionId) return;
    setSessionTitleDraft(activeSession?.title ?? t("ai.defaultSessionTitle"));
    setSessionDialog("rename");
  }

  function openDeleteDialog() {
    if (!sessionId) return;
    setSessionTitleDraft(activeSession?.title ?? t("ai.defaultSessionTitle"));
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

  const sessionOptions = [
    ...(!sessionId ? [{ value: "", label: t("ai.session.newChat") }] : []),
    ...sessions.map((session) => ({
      value: session.id,
      label: `${session.title}${typeof session.messageCount === "number" ? ` (${session.messageCount})` : ""}`,
    })),
  ];

  return (
    <div className={cn(
      "bg-surface border border-border-soft rounded-[24px] shadow-[0_18px_55px_rgba(15,23,42,0.06)] flex flex-col min-h-0 overflow-hidden",
      compact ? "border-0 rounded-none shadow-none flex-1" : "flex-1 h-full"
    )}>
      {(sessions.length > 0 || sessionId) && (
        <div className={cn(
          "shrink-0 flex items-center gap-2 bg-gradient-to-b from-surface to-canvas/25",
          compact ? "px-3 py-2" : "px-4 pb-2 pt-3"
        )}>
          <Select
            value={sessionId ?? ""}
            onChange={(event) => void switchSession(event.target.value)}
            disabled={busy}
            options={sessionOptions}
            size="sm"
            className="min-w-0 flex-1 bg-canvas text-xs font-semibold text-slate-600 dark:text-slate-300"
            aria-label={t("ai.session.chooseChat")}
          />
          <Button
            type="button"
            onClick={() => void newSession()}
            disabled={busy}
            variant="outline"
            size="iconSm"
            className="text-slate-500 hover:bg-surface-2"
            title={t("ai.session.createNewChat")}
            aria-label={t("ai.session.createNewChat")}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            onClick={openRenameDialog}
            disabled={busy || !sessionId}
            variant="outline"
            size="iconSm"
            className="text-slate-500 hover:bg-surface-2"
            title={t("ai.session.renameChat")}
            aria-label={t("ai.session.renameChat")}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            onClick={() => void clearMessages()}
            disabled={busy || !sessionId}
            variant="outline"
            size="iconSm"
            className="text-slate-500 hover:bg-surface-2"
            title={t("ai.session.clearChatMessages")}
            aria-label={t("ai.session.clearChatMessages")}
          >
            <Eraser className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            onClick={openDeleteDialog}
            disabled={busy || !sessionId}
            variant="outline"
            size="iconSm"
            className="text-slate-500 hover:bg-er-soft hover:text-er"
            title={t("ai.session.deleteChat")}
            aria-label={t("ai.session.deleteChat")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
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
                  {sessionDialog === "rename" ? t("ai.session.renameChat") : t("ai.session.deleteChat")}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {sessionDialog === "rename"
                    ? t("ai.session.renameDescription")
                    : t("ai.session.deleteDescription")}
                </div>
              </div>
              <Button
                type="button"
                onClick={() => setSessionDialog(null)}
                variant="outline"
                size="iconSm"
                className="shrink-0 text-slate-500 hover:bg-surface-2"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-4 py-4">
              {sessionDialog === "rename" ? (
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("ai.session.nameLabel")}</span>
                  <Input
                    autoFocus
                    value={sessionTitleDraft}
                    onChange={(event) => setSessionTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitRenameSession();
                      if (event.key === "Escape") setSessionDialog(null);
                    }}
                    maxLength={120}
                    className="mt-1.5 bg-canvas text-sm font-semibold text-slate-700 dark:text-slate-200"
                  />
                </label>
              ) : (
                <div className="rounded-xl border border-er/20 bg-er-soft px-3 py-2.5 text-sm font-semibold text-er">
                  {t("ai.session.deleteWarning", { title: sessionTitleDraft || t("ai.defaultSessionTitle") })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border-soft bg-canvas px-4 py-3">
              <Button type="button" onClick={() => setSessionDialog(null)} variant="outline" size="sm">
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => sessionDialog === "rename" ? void submitRenameSession() : void confirmDeleteSession()}
                disabled={busy || (sessionDialog === "rename" && !sessionTitleDraft.trim())}
                variant={sessionDialog === "delete" ? "destructive" : "default"}
                size="sm"
              >
                {sessionDialog === "rename" ? t("common.save") : t("common.delete")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {msgs.length > 0 && (
        <div className={cn(
          "shrink-0 flex items-center justify-between gap-3 bg-canvas/25",
          compact ? "px-3 py-1.5" : "px-4 py-1.5"
        )}>
          {usage ? (
            <div className={cn(
              "text-[11px] font-semibold",
              usage.exhausted ? "text-er" : usage.remaining <= Math.max(5, usage.limit * 0.1) ? "text-warn" : "text-slate-400"
            )}>
              {t("ai.session.usageCompact", {
                remaining: usage.remaining,
                limit: usage.limit,
                totalTokens: numberFormatter.format(usage.totalTokens),
              })}
            </div>
          ) : <span />}
          <Button
            type="button"
            onClick={() => void clearMessages()}
            disabled={busy}
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-0 text-[11px] font-semibold text-slate-400 hover:bg-transparent hover:text-er"
          >
            {t("ai.session.clearMessages")}
          </Button>
        </div>
      )}
      {msgs.length === 0 && usage && (
        <div className={cn(
          "shrink-0 bg-canvas/25 text-[11px] font-semibold",
          compact ? "px-3 py-1.5" : "px-4 py-1.5",
          usage.exhausted ? "text-er" : "text-slate-400"
        )}>
          {t("ai.session.usageFull", {
            remaining: usage.remaining,
            limit: usage.limit,
            period: usage.period,
            totalTokens: numberFormatter.format(usage.totalTokens),
            cost: usage.estimatedCostUsd.toFixed(4),
          })}
        </div>
      )}

      <div className={cn(
        "min-h-0 flex-1 overflow-y-auto flex flex-col gap-3 bg-gradient-to-b from-canvas/25 via-surface to-surface",
        compact ? "p-3" : "p-4"
      )}>
        {msgs.length === 0 ? (
          <div className="m-auto w-full max-w-3xl px-4 text-center text-slate-400">
            {compact ? (
              <MessageSquare className="w-9 h-9 mx-auto mb-3 opacity-60" />
            ) : (
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-60" />
            )}
            <p className="text-sm font-medium">{panelEmptyText}</p>
          </div>
        ) : msgs.map((m, i) => (
          <div key={`${m.role}-${i}`} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
            <div className={cn(
              "px-3.5 py-2 rounded-2xl text-sm leading-relaxed space-y-2",
              compact ? "max-w-[94%]" : "max-w-[82%]",
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
                onSelectChoice={(type, candidate) => {
                  const sourcePrompt = String(m.preview?.action.payload.prompt ?? m.text);
                  const selected = candidate.code
                    ? t("ai.preview.selectedChoiceWithCode", { type, label: candidate.label, code: candidate.code })
                    : t("ai.preview.selectedChoice", { type, label: candidate.label });
                  void send(`${sourcePrompt}\n${selected}`);
                }}
              />
            )}
          </div>
        ))}
        {busy && <AssistantProcessingBubble compact={compact} text={t("ai.session.processing")} />}
      </div>

      <div className={cn(
        "shrink-0 bg-gradient-to-t from-surface via-surface/95 to-surface/60",
        compact ? "px-3 pb-3 pt-2" : "px-4 pb-4 pt-2"
      )}>
        {surface === "web" && actionPresets.length > 0 && (
          <div className="mb-2">
            <ActionPresetButtons
              presets={actionPresets}
              activePreset={activePreset}
              busy={busy}
              onSelect={(preset) => void startActionSession(preset)}
              variant={compact ? "strip" : "grid"}
            />
          </div>
        )}
        {hasUploadingAttachment && (
          <div className="mb-2 text-[11px] font-semibold text-slate-400">
            {t("ai.session.uploadNotice")}
          </div>
        )}
        {usage?.exhausted && (
          <div className="mb-2 text-[11px] font-semibold text-er">
            {t("ai.session.exhaustedNotice")}
          </div>
        )}

        <div className={cn("grid gap-2", !compact && "sm:grid-cols-2")}>
          {suggestionGroups.map((group) => (
            <div key={group.id} className="min-w-0">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{group.title}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    disabled={composerDisabled}
                    onClick={() => send(s)}
                    variant="outline"
                    size="sm"
                    className="h-auto max-w-full rounded-full px-2.5 py-1 text-xs text-slate-600 hover:bg-surface-2 dark:text-slate-300"
                  >
                    <span className="truncate">{s}</span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); submitComposer(); }}
          className={cn(
            "mt-2 rounded-[28px] border border-border-soft bg-canvas/80 shadow-[0_12px_30px_rgba(15,23,42,0.05)]",
            compact ? "p-2.5" : "p-2"
          )}
        >
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
              accept={ACCEPTED_FILE_INPUT_TYPES}
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files ?? []);
                e.currentTarget.value = "";
              }}
            />
            <Button
              disabled={busy}
              type="button"
              onClick={() => fileRef.current?.click()}
              variant="outline"
              size="iconSm"
              className="h-9 w-9 rounded-full bg-surface text-slate-600 hover:bg-surface-2 shrink-0"
              title={t("ai.composer.attachFile")}
              aria-label={t("ai.composer.attachFile")}
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            {surface === "pos" && (
              <Button
                disabled={busy || listening}
                type="button"
                onClick={startVoiceInput}
                variant="outline"
                size="iconSm"
                className={cn(
                  "h-9 w-9 rounded-full bg-surface text-slate-600 hover:bg-surface-2 shrink-0",
                  listening && "border-primary-500 text-primary-600 bg-primary-50"
                )}
                title={listening ? t("ai.composer.listeningTitle") : t("ai.composer.voiceTitle")}
                aria-label={t("ai.composer.voiceAria")}
              >
                <Mic className="w-4 h-4" />
              </Button>
            )}
            <Textarea
              ref={composerRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (e.shiftKey) return;
                e.preventDefault();
                submitComposer();
              }}
              placeholder={attachments.length ? t("ai.composer.attachmentPlaceholder") : composerPlaceholder}
              rows={1}
              disabled={composerDisabled}
              className="ai-composer-scrollbar-hidden min-h-9 max-h-32 sm:max-h-40 flex-1 min-w-0 resize-none overflow-y-auto rounded-[18px] bg-canvas px-3 py-2 text-sm leading-5"
            />
            <Button
              disabled={sendDisabled}
              type="submit"
              size="iconSm"
              className="h-9 w-9 rounded-full bg-primary-600 text-white shrink-0"
              title={hasUploadingAttachment ? t("ai.composer.uploadingTitle") : hasComposerPayload ? t("ai.composer.sendTitle") : t("ai.composer.enterBeforeSend")}
              aria-label={t("ai.composer.sendTitle")}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
