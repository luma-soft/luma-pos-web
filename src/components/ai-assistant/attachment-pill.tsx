"use client";

import { useTranslations } from "next-intl";
import { FileText, ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
              ? t("ai.composer.uploading")
              : attachment.status === "failed"
                ? attachment.error ?? t("ai.composer.uploadFailed")
                : fileSizeText(attachment.size)}
          </div>
        )}
      </div>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          onClick={onRemove}
          className="h-5 w-5 rounded-full p-0 opacity-60 hover:bg-black/10 hover:opacity-100"
          aria-label={t("ai.composer.removeAttachment", { name: attachment.name })}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
