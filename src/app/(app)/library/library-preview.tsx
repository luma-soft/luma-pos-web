"use client";
import NextImage from "next/image";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowDownToLine,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileInfoPanel } from "@/components/media/file-info-panel";
import type { MediaLibraryItem } from "@/lib/media/library-types";
import { cn } from "@/lib/utils";
import { LibraryDialog } from "./library-dialog";
import { formatLibraryBytes, libraryRequest } from "./library-utils";

export function LibraryPreview({
  item,
  canManage,
  onClose,
  onDelete,
}: {
  item: MediaLibraryItem;
  canManage: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const common = useTranslations("common");
  const locale = useLocale();
  const [resolved, setResolved] = useState<MediaLibraryItem | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    libraryRequest<MediaLibraryItem>(
      `/api/mobile/library?resolve=${encodeURIComponent(item.id)}`,
      { signal: controller.signal },
    )
      .then((next) => {
        if (!controller.signal.aborted) setResolved(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [item.id, attempt]);
  return (
    <LibraryDialog
      wide
      title={item.title}
      description={`${item.album} · ${formatLibraryBytes(item.sizeBytes, locale)}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          {canManage ? (
            <Button
              variant="ghost"
              onClick={onDelete}
              className="gap-2 text-red-600"
            >
              <Trash2 className="h-4 w-4" />
              {common("delete")}
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <LockKeyhole className="h-3.5 w-3.5" />
              {t("privateShort")}
            </span>
          )}
          <div className="flex items-center gap-2">
            {!failed && resolved?.kind === "image" && (
              <button
                type="button"
                aria-label={t(zoomed ? "zoomOut" : "zoomIn")}
                title={t(zoomed ? "zoomOut" : "zoomIn")}
                onClick={() => setZoomed((value) => !value)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-surface text-slate-600 shadow-e1 transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
              >
                {zoomed ? (
                  <ZoomOut className="h-5 w-5" />
                ) : (
                  <ZoomIn className="h-5 w-5" />
                )}
              </button>
            )}
            <a
              href={`/api/mobile/library?open=${encodeURIComponent(item.id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white transition hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              <ArrowDownToLine className="h-4 w-4" />
              {t("download")}
            </a>
          </div>
        </div>
      }
    >
      <div className="grid sm:grid-cols-[minmax(0,1fr)_240px]">
        <div className="relative grid min-h-64 place-items-center overflow-auto bg-surface-2 sm:min-h-[420px]">
          {failed ? (
            <div className="p-6 text-center text-sm">
              <p>{t("errors.load")}</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              >
                {t("retry")}
              </Button>
            </div>
          ) : !resolved ? (
            <LoaderCircle
              aria-label={t("loading")}
              className="h-6 w-6 animate-spin text-primary-600"
            />
          ) : resolved.kind === "image" ? (
            <div
              className={cn(
                "relative h-[45dvh] w-full sm:h-[55dvh]",
                zoomed && "min-h-[80dvh] min-w-[160%]",
              )}
            >
              <NextImage
                unoptimized
                fill
                src={resolved.url}
                alt={resolved.title}
                className="object-contain p-3"
                sizes="80vw"
              />
            </div>
          ) : resolved.kind === "video" ? (
            <video
              controls
              playsInline
              preload="metadata"
              src={resolved.url}
              className="max-h-[55dvh] w-full"
            />
          ) : (
            <div className="p-8 text-center">
              <FileText className="mx-auto mb-4 h-14 w-14 stroke-[1.2] text-primary-600" />
              <p className="max-w-xs break-words text-sm font-medium">
                {resolved.fileName}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {t("documentPreviewHint")}
              </p>
            </div>
          )}
        </div>
        <aside className="space-y-5 p-4 sm:p-5">
          <div>
            <h3 className="text-xs font-semibold text-slate-500">
              {t("album")}
            </h3>
            <p className="mt-1.5 text-sm font-medium">{item.album}</p>
          </div>
          {item.note && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500">
                {t("note")}
              </h3>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6">
                {item.note}
              </p>
            </div>
          )}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="break-all rounded bg-surface-2 px-2 py-1 text-xs text-slate-600 dark:text-slate-300"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <FileInfoPanel
            key={item.id}
            fileName={item.fileName}
            mimeType={item.mimeType}
            sizeBytes={item.sizeBytes}
            uploadedAt={item.createdAt}
            uploaderName={(resolved ?? item).creatorName}
            metadata={(resolved ?? item).metadata}
            canManage={canManage && Boolean(resolved || failed)}
            onExtract={async (signal) => {
              const next = await libraryRequest<MediaLibraryItem>("/api/mobile/library", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "extract-metadata", id: item.id }),
                signal,
              });
              if (!signal.aborted) {
                setResolved(next);
                setFailed(false);
              }
              return next.metadata ?? null;
            }}
          />
        </aside>
      </div>
    </LibraryDialog>
  );
}
