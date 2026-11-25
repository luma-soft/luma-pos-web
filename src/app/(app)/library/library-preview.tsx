"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowDownToLine,
  FileText,
  Info,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LumaImage } from "@/components/luma-image";
import { FileInfoPanel } from "@/components/media/file-info-panel";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";
import type { MediaLibraryItem } from "@/lib/media/library-types";
import { cn } from "@/lib/utils";
import { LibraryDialog } from "./library-dialog";
import { formatLibraryBytes, libraryCanDelete, libraryCanExtractMetadata, libraryImageDisplayUrl, libraryItemSizeKnown, libraryItemSourcePreset, libraryItemUploadedAt, libraryRequest } from "./library-utils";

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
  const [infoOpen, setInfoOpen] = useState(false);
  const current = resolved ?? item;
  // Phones show images in the iOS LumaImageViewer: black, full screen, own chrome.
  const phoneViewer = item.kind === "image";
  const sourcePreset = libraryItemSourcePreset(current);
  const albumLabel = sourcePreset ? t(`sourceAlbums.${sourcePreset}`) : current.album;
  const sizeLabel = libraryItemSizeKnown(current) ? formatLibraryBytes(current.sizeBytes, locale) : t("unknownSize");
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
  async function extract(signal: AbortSignal) {
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
  }
  return (
    <LibraryDialog
      wide
      fixedHeight
      phoneViewer={phoneViewer}
      title={current.title}
      description={`${albumLabel} · ${sizeLabel}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          {libraryCanDelete(current, canManage) ? (
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
              {current.source ? <Link2 className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
              {t(current.source ? "automatic" : "privateShort")}
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
      {phoneViewer && (
        <PhoneImageViewer
          item={current}
          subtitle={`${albumLabel} · ${sizeLabel}`}
          imageUrl={resolved && !failed ? libraryImageDisplayUrl(resolved) : null}
          failed={failed}
          canDelete={libraryCanDelete(current, canManage)}
          onRetry={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
          onClose={onClose}
          onDelete={onDelete}
          onInfo={() => setInfoOpen(true)}
        />
      )}
      {phoneViewer && infoOpen && (
        <div className="fixed inset-0 z-10 flex items-end bg-black/40 lg:hidden" onClick={() => setInfoOpen(false)}>
          <div
            role="dialog"
            aria-label={t("info")}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[80dvh] w-full flex-col rounded-t-[22px] bg-canvas text-foreground"
          >
            <div className="flex items-center gap-3 px-ios-inset pb-1 pt-3">
              <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{t("info")}</h2>
              <button
                type="button"
                onClick={() => setInfoOpen(false)}
                aria-label={common("close")}
                data-button-radius="pill"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-black/[0.06] text-ios-label-secondary dark:bg-white/10"
              >
                <X className="size-4" strokeWidth={2.6} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
              <LibraryPreviewDetails
                item={current}
                canManage={canManage}
                extractionReady={Boolean(resolved || (!current.source && failed))}
                onExtract={extract}
              />
            </div>
          </div>
        </div>
      )}
      <div className={cn("grid min-w-0 sm:h-full sm:min-h-0 sm:grid-cols-[minmax(0,1fr)_240px] sm:grid-rows-[minmax(0,1fr)]", phoneViewer && "max-lg:hidden")}>
        <div
          role="region"
          aria-label={current.title}
          tabIndex={0}
          className="relative h-[45dvh] min-h-64 min-w-0 overflow-auto overscroll-contain bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600 sm:h-full sm:min-h-0"
        >
          <div className={cn(
            "relative grid h-full w-full place-items-center",
            !failed && resolved?.kind === "image" && zoomed && "h-[160%] w-[160%]",
          )}>
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
              <LumaImage
                unoptimized
                fill
                src={libraryImageDisplayUrl(resolved)}
                alt={resolved.title}
                containerClassName="absolute inset-0"
                className="object-contain p-3"
                sizes="80vw"
                fallbackLabel={t("errors.load")}
              />
            ) : resolved.kind === "video" ? (
              <video
                controls
                playsInline
                preload="metadata"
                src={resolved.url}
                className="h-full max-h-full w-full object-contain"
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
        </div>
        <LibraryPreviewDetails
          item={current}
          canManage={canManage}
          extractionReady={Boolean(resolved || (!current.source && failed))}
          onExtract={extract}
        />
      </div>
    </LibraryDialog>
  );
}

export function LibraryPreviewDetails({ item, canManage, extractionReady = true, onExtract }: {
  item: MediaLibraryItem;
  canManage: boolean;
  extractionReady?: boolean;
  onExtract: (signal: AbortSignal) => Promise<MediaFileMetadata | null>;
}) {
  const t = useTranslations("mediaLibrary");
  const fileInfo = useTranslations("fileInfo");
  const sourcePreset = libraryItemSourcePreset(item);
  // Source permissions may have changed since the gallery snapshot. Do not show
  // cached source metadata or actions until the current association resolves.
  if (item.source && !extractionReady) return null;
  return <aside className="min-h-0 min-w-0 space-y-5 p-4 sm:overflow-y-auto sm:overscroll-contain sm:p-5">
          <div>
            <h3 className="text-xs font-semibold text-slate-500">
              {t("album")}
            </h3>
            <p className="mt-1.5 break-words text-sm font-medium">{sourcePreset ? t(`sourceAlbums.${sourcePreset}`) : item.album}</p>
          </div>
          {item.source && <div className="space-y-2 text-xs leading-5 text-slate-500">
            <p className="flex items-center gap-1.5 font-semibold text-primary-700 dark:text-primary-300"><Link2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />{t("automatic")}</p>
            <p className="break-words">{t("linkedSource", { source: item.source.label })}</p>
            <p>{t("sourceReadOnlyHint")}</p>
          </div>}
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
            mimeType={item.mimeType === "image/*" ? fileInfo("unknown") : item.mimeType}
            sizeBytes={item.sizeBytes}
            sizeKnown={libraryItemSizeKnown(item)}
            uploadedAt={libraryItemUploadedAt(item)}
            uploaderName={item.creatorName}
            metadata={item.metadata}
            canExtractMetadata={libraryCanExtractMetadata(item, canManage) && extractionReady}
            onExtract={onExtract}
          />
        </aside>;
}

/** Phone image viewer, like LumaImageViewer on iOS: close, title and download on top, actions below. */
function PhoneImageViewer({
  item,
  subtitle,
  imageUrl,
  failed,
  canDelete,
  onRetry,
  onClose,
  onDelete,
  onInfo,
}: {
  item: MediaLibraryItem;
  subtitle: string;
  imageUrl: string | null;
  failed: boolean;
  canDelete: boolean;
  onRetry: () => void;
  onClose: () => void;
  onDelete: () => void;
  onInfo: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const common = useTranslations("common");
  const circle = "grid size-[42px] shrink-0 place-items-center rounded-full bg-white/[0.12] text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60";
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-black text-white lg:hidden">
      <div className="flex items-center gap-3 px-ios-inset pb-2.5 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button type="button" onClick={onClose} aria-label={common("close")} data-button-radius="pill" className={circle}>
          <X className="size-[18px]" strokeWidth={2.6} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{item.title}</p>
          <p className="truncate text-[12px] text-white/70">{subtitle}</p>
        </div>
        <a
          href={`/api/mobile/library?open=${encodeURIComponent(item.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("download")}
          data-button-radius="pill"
          className={circle}
        >
          <ArrowDownToLine className="size-5" strokeWidth={2.4} aria-hidden="true" />
        </a>
      </div>
      {item.source && (
        <p className="flex items-center gap-1.5 px-ios-inset pb-2 text-[13px] text-white/[0.78]">
          <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">{t("linkedSource", { source: item.source.label })}</span>
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        {failed ? (
          <div className="grid h-full place-items-center p-6 text-center text-[13px] text-white/70">
            <div>
              <p>{t("errors.load")}</p>
              <button type="button" onClick={onRetry} className="mt-3 min-h-11 px-4 text-[15px] font-semibold text-ios-accent">
                {t("retry")}
              </button>
            </div>
          </div>
        ) : imageUrl ? (
          <LumaImage
            unoptimized
            fill
            src={imageUrl}
            alt={item.title}
            containerClassName="absolute inset-0 bg-black"
            className="object-contain"
            sizes="100vw"
            fallbackLabel={t("errors.load")}
          />
        ) : (
          <div className="grid h-full place-items-center">
            <LoaderCircle aria-label={t("loading")} className="size-6 animate-spin text-white/80" />
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-2 px-ios-inset pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-center">
        <button type="button" onClick={onInfo} className="inline-flex min-h-11 items-center gap-1.5 px-3 text-[15px] font-medium text-ios-accent">
          <Info className="size-[18px]" aria-hidden="true" />
          {t("info")}
        </button>
        {item.note?.trim() && <p className="line-clamp-2 text-[13px] text-white/[0.88]">{item.note}</p>}
        {item.tags.length > 0 && (
          <p className="line-clamp-2 text-[12px] text-ios-accent">{item.tags.map((tag) => `#${tag}`).join("  ")}</p>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] bg-ios-red/15 px-4 text-[15px] font-semibold text-ios-red"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {common("delete")}
          </button>
        )}
      </div>
    </div>
  );
}
