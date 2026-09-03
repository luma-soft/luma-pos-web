"use client";

import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  FileText,
  Film,
  Image as ImageIcon,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import {
  ManagedMediaUploadError,
  resumeManagedMediaCompletion,
  uploadManagedMedia,
} from "@/lib/media/client";
import { mediaLibraryMaxBytesForMime } from "@/lib/media/library-schema";
import { cn } from "@/lib/utils";
import { LibraryDialog } from "./library-dialog";
import {
  formatLibraryBytes,
  libraryFileKey,
  libraryFileTitle,
  libraryMetadataValid,
  libraryRequest,
} from "./library-utils";
import type { LibraryNotice } from "./media-library-client";

const ACCEPT =
  ".avif,.gif,.heic,.heif,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.m4v,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt";
export function LibraryUploadDialog({
  storeId,
  albums,
  initialAlbum = "",
  onClose,
  onUploaded,
}: {
  storeId: string;
  albums: string[];
  initialAlbum?: string;
  onClose: () => void;
  onUploaded: (notice: LibraryNotice) => Promise<void>;
}) {
  const t = useTranslations("mediaLibrary");
  const common = useTranslations("common");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [album, setAlbum] = useState(initialAlbum);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{
    index: number;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const uploadedIds = useRef(new Map<string, string>());
  const completionIds = useRef(new Map<string, string>());
  const running = useRef(false);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function addFiles(selected: File[]) {
    if (running.current) return;
    setFiles((current) => {
      const keys = new Set(current.map(libraryFileKey));
      return [
        ...current,
        ...selected.filter((file) => {
          const key = libraryFileKey(file);
          if (keys.has(key)) return false;
          keys.add(key);
          return true;
        }),
      ];
    });
    setError(null);
  }
  const invalidFile = files.find((file) => !validFile(file));
  const validMetadata = libraryMetadataValid(album, note, tags);
  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  async function uploadFiles() {
    if (running.current || !files.length || invalidFile || !validMetadata)
      return;
    running.current = true;
    setBusy(true);
    setError(null);
    setFailedKeys(new Set());
    const failed: File[] = [];
    let success = 0;
    for (const [index, file] of files.entries()) {
      const key = libraryFileKey(file);
      setProgress({ index: index + 1, name: file.name });
      try {
        let mediaId = uploadedIds.current.get(key);
        if (!mediaId) {
          const request = {
            purpose: "library-asset" as const,
            targetId: storeId,
          };
          const completionId = completionIds.current.get(key);
          const media = completionId
            ? await resumeManagedMediaCompletion(file, request, completionId)
            : await uploadManagedMedia(file, request);
          mediaId = media.id;
          uploadedIds.current.set(key, media.id);
          completionIds.current.delete(key);
        }
        await libraryRequest("/api/mobile/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId,
            album,
            title: libraryFileTitle(file.name),
            note,
            tags,
          }),
        });
        success += 1;
        uploadedIds.current.delete(key);
      } catch (cause) {
        if (
          cause instanceof ManagedMediaUploadError &&
          cause.retryFrom === "complete" &&
          cause.mediaId
        ) {
          if (cause.statusCode === 404 || cause.statusCode === 410)
            completionIds.current.delete(key);
          else completionIds.current.set(key, cause.mediaId);
        }
        // A lost POST acknowledgement may still have attached the file. Preserve its id for an idempotent retry.
        failed.push(file);
        setFailedKeys((current) => new Set([...current, key]));
      }
    }
    setFiles(failed);
    setProgress(null);
    try {
      if (!failed.length) {
        await onUploaded({
          tone: "success",
          text: t("uploaded", { count: success }),
        });
        onClose();
      } else {
        setError(t("partialUpload", { success, failed: failed.length }));
        if (success)
          await onUploaded({
            tone: "success",
            text: t("uploaded", { count: success }),
          });
      }
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  return (
    <LibraryDialog
      wide
      title={t("uploadTitle")}
      description={t("uploadHint")}
      busy={busy}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="hidden text-xs tabular-nums text-slate-500 sm:block">
            {files.length
              ? `${t("selectedFiles", { count: files.length })} · ${formatLibraryBytes(totalBytes, locale)}`
              : t("chooseFilesHint")}
          </span>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={busy}
              className="flex-1 sm:flex-none"
            >
              {common("cancel")}
            </Button>
            <Button
              onClick={() => void uploadFiles()}
              disabled={!files.length || Boolean(invalidFile) || !validMetadata}
              loading={busy}
              className="flex-1 gap-2 sm:flex-none"
            >
              {!busy && <Upload className="h-4 w-4" />}
              {failedKeys.size
                ? t("retry")
                : t("uploadCount", { count: files.length })}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="p-4 sm:p-6" aria-label={t("chooseFiles")}>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(Array.from(event.dataTransfer.files));
            }}
            className={cn(
              "flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50",
              dragging
                ? "border-primary-500 bg-primary-100"
                : "border-primary-300 bg-primary-50/50 hover:bg-primary-50 dark:border-primary-800 dark:bg-primary-950/20",
            )}
          >
            <Upload className="h-6 w-6 text-primary-600" />
            <span className="text-sm font-semibold">
              {t(files.length ? "addFiles" : "chooseFiles")}
            </span>
            <span className="text-xs text-slate-500">{t("dropHint")}</span>
          </button>
          <input
            ref={inputRef}
          type="file"
          hidden
          className="hidden"
            multiple
            accept={ACCEPT}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          {files.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold text-slate-500">
                {t("selectedFiles", { count: files.length })}
              </p>
              <ul className="divide-y divide-border">
                {files.map((file) => (
                  <UploadFileRow
                    key={libraryFileKey(file)}
                    file={file}
                    locale={locale}
                    busy={busy}
                    failed={failedKeys.has(libraryFileKey(file))}
                    onRemove={() =>
                      setFiles((current) =>
                        current.filter(
                          (candidate) =>
                            libraryFileKey(candidate) !== libraryFileKey(file),
                        ),
                      )
                    }
                  />
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-5 flex justify-center gap-5 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <ImageIcon className="h-4 w-4" />
                {t("types.image")}
              </span>
              <span className="flex items-center gap-1.5">
                <Film className="h-4 w-4" />
                {t("types.video")}
              </span>
              <span className="flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                {t("types.document")}
              </span>
            </div>
          )}
        </section>
        <section className="space-y-4 border-t border-border bg-surface-2/50 p-4 sm:border-l sm:border-t-0 sm:p-6">
          <Field label={t("album")}>
            <Input
              aria-label={t("album")}
              value={album}
              onChange={(event) => setAlbum(event.target.value)}
              maxLength={80}
              placeholder={t("albumPlaceholder")}
              disabled={busy}
            />
          </Field>
          {albums.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-slate-500">
                {t("existingAlbums")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {albums.slice(0, 8).map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={album === name}
                    onClick={() => setAlbum(name)}
                    disabled={busy}
                    className={cn(
                      "min-h-11 min-w-11 max-w-full truncate rounded-lg border px-3 text-xs font-medium transition disabled:opacity-50",
                      album === name
                        ? "border-primary-300 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"
                        : "border-border bg-surface text-slate-500 hover:border-primary-300",
                    )}
                  >
                    <span>{name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs leading-5 text-slate-500">{t("albumHint")}</p>
          <details className="group border-t border-border pt-1">
            <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
              {t("optionalDetails")}
              <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="space-y-4 pt-2">
              <Field label={t("note")}>
                <Textarea
                  aria-label={t("note")}
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("notePlaceholder")}
                  disabled={busy}
                />
              </Field>
              <Field label={t("tags")}>
                <TagInput
                  aria-label={t("tags")}
                  value={tags}
                  onChange={setTags}
                  maxTags={12}
                  maxTagLength={40}
                  placeholder={t("tagsPlaceholder")}
                  disabled={busy}
                />
              </Field>
              <p className="text-xs leading-5 text-slate-500">
                {t("tagsHint")}
              </p>
            </div>
          </details>
        </section>
      </div>
      {(error || !validMetadata || progress) && (
        <div
          role={error || !validMetadata ? "alert" : "status"}
          className={cn(
            "mx-4 mb-4 rounded-lg px-3 py-3 text-sm sm:mx-6",
            error || !validMetadata
              ? "bg-er-soft text-er"
              : "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200",
          )}
        >
          {error ||
            (!validMetadata
              ? t("metadataError")
              : progress
                ? t("uploading", {
                    current: progress.index,
                    total: files.length,
                    name: progress.name,
                  })
                : "")}
          {progress && (
            <div role="progressbar" aria-valuenow={progress.index - 1} aria-valuemin={0} aria-valuemax={files.length} aria-label={t("uploading", { current: progress.index, total: files.length, name: progress.name })} className="mt-3 h-1 w-full overflow-hidden rounded-full bg-primary-100">
              <div className="h-full rounded-full bg-primary-600 transition-[width]" style={{ width: `${files.length ? ((progress.index - 1) / files.length) * 100 : 0}%` }} />
            </div>
          )}
        </div>
      )}
    </LibraryDialog>
  );
}

function validFile(file: File) {
  const max = mediaLibraryMaxBytesForMime(file.type);
  return max !== null && file.size > 0 && file.size <= max;
}

function UploadFileRow({
  file,
  locale,
  busy,
  failed,
  onRemove,
}: {
  file: File;
  locale: string;
  busy: boolean;
  failed: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/") || !imageRef.current) return;
    const preview = URL.createObjectURL(file);
    imageRef.current.src = preview;
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  const invalid = !validFile(file);
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 text-slate-400">
        {file.type.startsWith("image/") ? (
          <NextImage
            ref={imageRef}
            fill
            unoptimized
            src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            alt={file.name}
            sizes="44px"
            className="object-cover"
          />
        ) : file.type.startsWith("video/") ? (
          <Film className="h-5 w-5" />
        ) : (
          <FileText className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium sm:text-sm">{file.name}</p>
        <p
          className={cn(
            "mt-1 text-[11px]",
            invalid || failed ? "text-er" : "text-slate-500",
          )}
        >
          {invalid
            ? t("invalidFile", { name: file.name })
            : failed
              ? t("fileRetryHint")
              : formatLibraryBytes(file.size, locale)}
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        aria-label={t("removeSelection", { name: file.name })}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-er-soft hover:text-er disabled:opacity-40"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}
