"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, FileText, ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveAiAttachmentUrl } from "./api";
import type { ComposerAttachment } from "./types";
import { fileSizeText } from "./utils";

export function AttachmentPill({
  attachment,
  compact = false,
  onRemove,
}: {
  attachment: ComposerAttachment;
  compact?: boolean;
  onRemove?: () => void;
}) {
  const t = useTranslations();
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const canPreview = Boolean(attachment.previewUrl || attachment.signedUrl || (attachment.bucket && attachment.path));
  const isImage = attachment.kind === "image";
  const isPdf = attachment.mimeType === "application/pdf";

  async function openViewer() {
    setViewerError(null);
    const url = await resolveAiAttachmentUrl(attachment).catch(() => null);
    if (!url) {
      setViewerError(t("ai.composer.attachmentUnavailable"));
      return;
    }
    setViewerUrl(url);
  }

  const content = (
    <>
      {attachment.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachment.previewUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
      ) : attachment.kind === "image" ? (
        <ImageIcon className="h-4 w-4 shrink-0" />
      ) : (
        <FileText className="h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 text-left">
        <div className="max-w-40 truncate font-semibold">{attachment.name}</div>
        {!compact && (
          <div className={cn(
            "text-[10px] opacity-70",
            attachment.status === "failed" && "text-er opacity-100",
          )}>
            {attachment.status === "uploading"
              ? t("ai.composer.uploading")
              : attachment.status === "failed"
                ? attachment.error ?? t("ai.composer.uploadFailed")
                : fileSizeText(attachment.size)}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <div className={cn(
        "group flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs",
        compact ? "border-white/25 bg-white/10 text-current" : "border-border bg-surface-2 text-slate-600 dark:text-slate-300",
        canPreview && (compact
          ? "cursor-pointer hover:border-white/40 hover:bg-white/15"
          : "cursor-pointer hover:border-primary-200 hover:bg-primary-50/70")
      )}>
        {canPreview ? (
          <button
            type="button"
            onClick={openViewer}
            className="flex min-h-11 min-w-11 flex-1 items-center gap-2 text-left lg:min-h-0"
            title={t("ai.composer.previewAttachment", { name: attachment.name })}
            aria-label={t("ai.composer.previewAttachment", { name: attachment.name })}
          >
            {content}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {content}
          </div>
        )}
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            onClick={onRemove}
            className="h-11 w-11 rounded-full p-0 opacity-60 hover:bg-black/10 hover:opacity-100 lg:h-5 lg:w-5"
            aria-label={t("ai.composer.removeAttachment", { name: attachment.name })}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {(viewerUrl || viewerError) && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setViewerUrl(null);
              setViewerError(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={t("ai.composer.previewAttachment", { name: attachment.name })}
            className="flex max-h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-border bg-surface shadow-e2"
          >
            <header className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{attachment.name}</div>
                <div className="text-xs font-medium text-slate-400">{fileSizeText(attachment.size)}</div>
              </div>
              <div className="flex items-center gap-2">
                {viewerUrl && (
                  <a
                    href={viewerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-slate-600 hover:bg-surface-2 lg:h-8 lg:min-w-0"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("ai.composer.openAttachment")}
                  </a>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="iconSm"
                  onClick={() => {
                    setViewerUrl(null);
                    setViewerError(null);
                  }}
                  className="shrink-0 text-slate-500 hover:bg-surface-2"
                  aria-label={t("common.close")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-auto bg-canvas/60 p-3">
              {viewerError ? (
                <div className="rounded-xl border border-er/20 bg-er-soft px-4 py-3 text-sm font-semibold text-er">
                  {viewerError}
                </div>
              ) : isImage ? (
                <div className="flex min-h-[320px] items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={viewerUrl ?? ""} alt={attachment.name} className="max-h-[72dvh] max-w-full rounded-xl object-contain shadow-e1" />
                </div>
              ) : isPdf ? (
                <iframe src={viewerUrl ?? ""} title={attachment.name} className="h-[72dvh] w-full rounded-xl border border-border bg-white" />
              ) : (
                <div className="grid min-h-[260px] place-items-center rounded-xl border border-border bg-surface px-5 text-center">
                  <div>
                    <FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{attachment.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{t("ai.composer.openAttachmentHint")}</div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
