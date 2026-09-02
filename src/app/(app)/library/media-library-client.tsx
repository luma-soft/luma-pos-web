"use client";

import NextImage from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Film,
  HardDrive,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { uploadManagedMedia } from "@/lib/media/client";
import {
  mediaLibraryMaxBytesForMime,
} from "@/lib/media/library-schema";
import type {
  MediaLibraryItem,
  MediaLibrarySnapshot,
} from "@/lib/media/library-types";
import { normalizeSearch } from "@/lib/normalize";
import { cn } from "@/lib/utils";

const ALL_ALBUMS = "__all_albums__";
const ALL_KINDS = "__all_kinds__";
const LIBRARY_ACCEPT = [
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/plain",
].join(",");

type Notice = { tone: "success" | "error"; text: string } | null;

export function MediaLibraryClient({
  initialSnapshot,
  storeId,
}: {
  initialSnapshot: MediaLibrarySnapshot;
  storeId: string;
}) {
  const t = useTranslations("mediaLibrary");
  const common = useTranslations("common");
  const locale = useLocale();
  const dialog = useConfirmDialog();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [query, setQuery] = useState("");
  const [album, setAlbum] = useState(ALL_ALBUMS);
  const [kind, setKind] = useState(ALL_KINDS);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = await requestJson<MediaLibrarySnapshot>("/api/mobile/library");
      setSnapshot(next);
      return true;
    } catch {
      setNotice({ tone: "error", text: t("errors.load") });
      return false;
    } finally {
      setRefreshing(false);
    }
  }

  const normalizedQuery = normalizeSearch(query);
  const filteredItems = useMemo(() => snapshot.items.filter((item) => {
    if (album !== ALL_ALBUMS && item.album !== album) return false;
    if (kind !== ALL_KINDS && item.kind !== kind) return false;
    if (!normalizedQuery) return true;
    return normalizeSearch([
      item.title,
      item.fileName,
      item.album,
      item.note ?? "",
      ...item.tags,
    ].join(" ")).includes(normalizedQuery);
  }), [album, kind, normalizedQuery, snapshot.items]);

  const albumOptions = [
    { value: ALL_ALBUMS, label: t("albumAll") },
    ...snapshot.albums.map((entry) => ({
      value: entry.name,
      label: `${entry.name} (${entry.count})`,
    })),
  ];
  const kindOptions = [
    { value: ALL_KINDS, label: t("typeAll") },
    { value: "image", label: t("types.image") },
    { value: "video", label: t("types.video") },
    { value: "document", label: t("types.document") },
  ];

  async function removeItem(item: MediaLibraryItem) {
    const confirmed = await dialog.confirm({
      title: t("deleteTitle"),
      description: t("deleteDescription", { title: item.title }),
      confirmLabel: common("delete"),
      cancelLabel: common("cancel"),
      variant: "destructive",
    });
    if (!confirmed) return;
    setDeletingId(item.id);
    setNotice(null);
    try {
      await requestJson(`/api/mobile/library?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      await refresh();
    } catch {
      setNotice({ tone: "error", text: t("errors.delete") });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-full bg-canvas">
      <header className="border-b border-border bg-surface px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-primary-600">
              <Images className="h-5 w-5" />
              <span className="text-xs font-black uppercase tracking-[0.14em]">Luma Library</span>
            </div>
            <h1 className="text-2xl font-black tracking-[-0.03em] text-slate-950 dark:text-white sm:text-3xl">
              {t("title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              {t("subtitle")}
            </p>
          </div>
          {snapshot.canManage && (
            <Button onClick={() => setUploadOpen(true)} className="shrink-0 gap-2 sm:self-end">
              <Upload className="h-4 w-4" />
              {t("upload")}
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 p-3 sm:p-5 lg:p-8">
        <section className="grid gap-3 sm:grid-cols-2">
          <UsageCard
            icon={HardDrive}
            label={t("usageLibrary")}
            bytes={snapshot.usage.libraryBytes}
            hint={t("unlimitedHint")}
            objectsLabel={t("usageObjects", { count: snapshot.usage.libraryObjects })}
            accent="primary"
          />
          <UsageCard
            icon={ShieldCheck}
            label={t("usageTotal")}
            bytes={snapshot.usage.totalBytes}
            hint={t("privateHint")}
            objectsLabel={t("usageObjects", { count: snapshot.usage.totalObjects })}
            accent="slate"
          />
        </section>

        {notice && (
          <div className={cn(
            "rounded-xl border px-4 py-3 text-sm font-semibold",
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
          )}>
            {notice.text}
          </div>
        )}

        <section className="rounded-2xl border border-border bg-surface p-3 shadow-e1 sm:p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_260px_220px_auto] lg:items-center">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              leftIcon={<Search />}
            />
            <Select
              value={album}
              onValueChange={setAlbum}
              options={albumOptions}
              searchable={snapshot.albums.length > 8}
              searchPlaceholder={t("searchPlaceholder")}
              aria-label={t("album")}
            />
            <Select
              value={kind}
              onValueChange={setKind}
              options={kindOptions}
              aria-label={t("typeAll")}
            />
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-slate-500 transition hover:bg-surface-2 hover:text-slate-900 disabled:opacity-60 dark:hover:text-white lg:min-h-10"
            >
              <LoaderCircle className={cn("h-4 w-4", refreshing && "animate-spin")} />
              {common("refresh")}
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs font-semibold text-slate-400">
            <span>{t("itemsCount", { count: filteredItems.length })}</span>
            {(album !== ALL_ALBUMS || kind !== ALL_KINDS || query) && (
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg px-2 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40 lg:min-h-9"
                onClick={() => { setAlbum(ALL_ALBUMS); setKind(ALL_KINDS); setQuery(""); }}
              >
                {common("clear")}
              </button>
            )}
          </div>
        </section>

        {filteredItems.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredItems.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                locale={locale}
                canManage={snapshot.canManage}
                deleting={deletingId === item.id}
                onDelete={() => void removeItem(item)}
              />
            ))}
          </section>
        ) : (
          <section className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-border bg-surface/60 px-6 text-center">
            <div className="max-w-sm py-12">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-950/50">
                <ImageIcon className="h-7 w-7" />
              </div>
              <h2 className="text-base font-black">{t("emptyTitle")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("emptyDescription")}</p>
              {snapshot.canManage && (
                <Button size="sm" className="mt-4 gap-2" onClick={() => setUploadOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t("upload")}
                </Button>
              )}
            </div>
          </section>
        )}
      </main>

      {uploadOpen && (
        <UploadDialog
          storeId={storeId}
          albums={snapshot.albums.map((entry) => entry.name)}
          onClose={() => setUploadOpen(false)}
          onUploaded={async (message) => {
            setNotice(message);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function UsageCard({
  icon: Icon,
  label,
  bytes,
  objectsLabel,
  hint,
  accent,
}: {
  icon: typeof HardDrive;
  label: string;
  bytes: number;
  objectsLabel: string;
  hint: string;
  accent: "primary" | "slate";
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-e1 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{formatBytes(bytes)}</p>
          <p className="mt-1 text-xs font-semibold text-slate-400">{objectsLabel}</p>
        </div>
        <div className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-2xl",
          accent === "primary"
            ? "bg-primary-50 text-primary-600 dark:bg-primary-950/50"
            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        )}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 border-t border-border pt-3 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function MediaCard({
  item,
  locale,
  canManage,
  deleting,
  onDelete,
}: {
  item: MediaLibraryItem;
  locale: string;
  canManage: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const common = useTranslations("common");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(item.createdAt));

  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-e1 transition hover:-translate-y-0.5 hover:shadow-e2">
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-900">
        {item.kind === "image" && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="relative block h-full min-h-11 w-full min-w-11">
            <NextImage
              unoptimized
              fill
              src={item.thumbnailUrl ?? item.url}
              alt={item.title}
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
              className="object-cover transition duration-300 group-hover:scale-[1.025]"
            />
          </a>
        )}
        {item.kind === "video" && (
          <video
            controls
            preload="metadata"
            src={item.url}
            className="h-full w-full bg-slate-950 object-contain"
          />
        )}
        {item.kind === "document" && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-full min-h-11 min-w-11 flex-col items-center justify-center gap-3 p-6 text-center transition hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <DocumentIcon mimeType={item.mimeType} />
            <span className="line-clamp-2 max-w-full text-sm font-bold text-slate-600 dark:text-slate-300">{item.fileName}</span>
          </a>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-slate-950/72 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur">
          {t(`types.${item.kind}`)}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-black text-slate-950 dark:text-white" title={item.title}>{item.title}</h2>
            <p className="mt-1 truncate text-xs font-bold text-primary-600">{item.album}</p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              aria-label={`${common("delete")}: ${item.title}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40 lg:h-10 lg:w-10"
            >
              {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
        </div>
        {item.note && <p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-500">{item.note}</p>}
        {item.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.tags.slice(0, 5).map((tag) => (
              <span key={tag} className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-bold text-slate-500">#{tag}</span>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-0 text-[11px] leading-5 text-slate-400">
            <p>{formatBytes(item.sizeBytes)} · {date}</p>
            <p className="truncate">{t("createdBy", { name: item.creatorName ?? t("unknownCreator") })}</p>
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t(item.kind === "document" ? "download" : "open")}: ${item.title}`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border text-slate-500 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-950/40 lg:h-10 lg:w-10"
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>
    </article>
  );
}

function DocumentIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") {
    return <FileSpreadsheet className="h-16 w-16 text-emerald-600" />;
  }
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) {
    return <FileArchive className="h-16 w-16 text-orange-600" />;
  }
  return <FileText className="h-16 w-16 text-primary-600" />;
}

function UploadDialog({
  storeId,
  albums,
  onClose,
  onUploaded,
}: {
  storeId: string;
  albums: string[];
  onClose: () => void;
  onUploaded: (notice: NonNullable<Notice>) => Promise<void>;
}) {
  const t = useTranslations("mediaLibrary");
  const common = useTranslations("common");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [album, setAlbum] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    setFiles((current) => {
      const keys = new Set(current.map(fileKey));
      return [...current, ...selected.filter((file) => !keys.has(fileKey(file)))];
    });
    setError(null);
    event.target.value = "";
  }

  const invalidFile = files.find((file) => {
    const maxBytes = mediaLibraryMaxBytesForMime(file.type);
    return file.size <= 0 || maxBytes === null || file.size > maxBytes;
  });

  async function uploadFiles() {
    if (files.length === 0 || invalidFile) return;
    setBusy(true);
    setError(null);
    let success = 0;
    const failed: File[] = [];
    const normalizedTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);

    for (const [index, file] of files.entries()) {
      setProgress(t("uploading", { current: index + 1, total: files.length, name: file.name }));
      let mediaId: string | null = null;
      try {
        const media = await uploadManagedMedia(file, {
          purpose: "library-asset",
          targetId: storeId,
        });
        mediaId = media.id;
        await requestJson("/api/mobile/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId: media.id,
            album,
            title: titleForFile(file.name),
            note,
            tags: normalizedTags,
          }),
        });
        success += 1;
      } catch {
        failed.push(file);
        if (mediaId) {
          await fetch(`/api/mobile/media/${encodeURIComponent(mediaId)}`, {
            method: "DELETE",
            credentials: "same-origin",
          }).catch(() => undefined);
        }
      }
    }

    setBusy(false);
    setProgress("");
    setFiles(failed);
    if (failed.length === 0) {
      await onUploaded({ tone: "success", text: t("uploaded", { count: success }) });
      onClose();
      return;
    }
    await onUploaded({
      tone: "error",
      text: t("partialUpload", { success, failed: failed.length }),
    });
    setError(t("errors.upload"));
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/55 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={() => { if (!busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-library-upload-title"
        className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 id="media-library-upload-title" className="text-xl font-black tracking-tight">{t("uploadTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("uploadHint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={common("close")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-surface-2 hover:text-slate-800 disabled:opacity-50 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="flex min-h-36 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary-200 bg-primary-50/60 px-5 py-6 text-center transition hover:border-primary-400 hover:bg-primary-50 disabled:opacity-50 dark:border-primary-900 dark:bg-primary-950/25"
          >
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-600 text-white shadow-lg shadow-primary-600/20">
              <Upload className="h-5 w-5" />
            </span>
            <span className="mt-3 text-sm font-black text-slate-900 dark:text-white">{t("chooseFiles")}</span>
            <span className="mt-1 text-xs text-slate-500">{t("chooseFilesHint")}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={LIBRARY_ACCEPT}
            onChange={selectFiles}
            className="sr-only"
          />

          {files.length > 0 && (
            <div className="mt-4 rounded-2xl border border-border">
              <div className="border-b border-border px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-400">
                {t("selectedFiles", { count: files.length })}
              </div>
              <div className="max-h-48 divide-y divide-border overflow-y-auto">
                {files.map((file) => {
                  const maxBytes = mediaLibraryMaxBytesForMime(file.type);
                  const invalid = file.size <= 0 || maxBytes === null || file.size > maxBytes;
                  return (
                    <div key={fileKey(file)} className="flex items-center gap-3 px-4 py-3">
                      {file.type.startsWith("video/") ? <Film className="h-4 w-4 shrink-0 text-violet-500" /> : file.type.startsWith("image/") ? <ImageIcon className="h-4 w-4 shrink-0 text-primary-500" /> : <FileText className="h-4 w-4 shrink-0 text-emerald-500" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{file.name}</p>
                        <p className={cn("text-xs", invalid ? "text-red-600" : "text-slate-400")}>
                          {invalid ? t("invalidFile", { name: file.name }) : formatBytes(file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setFiles((current) => current.filter((candidate) => fileKey(candidate) !== fileKey(file)))}
                        aria-label={t("removeSelection", { name: file.name })}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 lg:h-9 lg:w-9"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5 grid gap-4">
            <Field label={t("album")}>
              <Input value={album} onChange={(event) => setAlbum(event.target.value)} maxLength={80} placeholder={t("albumPlaceholder")} disabled={busy} />
            </Field>
            {albums.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold text-slate-400">{t("existingAlbums")}</p>
                <div className="flex flex-wrap gap-2">
                  {albums.slice(0, 12).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setAlbum(name)}
                      disabled={busy}
                      className={cn(
                        "min-h-11 min-w-11 rounded-full border px-3 text-xs font-bold transition lg:min-h-9",
                        album === name
                          ? "border-primary-600 bg-primary-600 text-white"
                          : "border-border bg-surface text-slate-500 hover:border-primary-300 hover:text-primary-700",
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Field label={t("note")}>
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} placeholder={t("notePlaceholder")} disabled={busy} />
            </Field>
            <Field label={t("tags")}>
              <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("tagsPlaceholder")} disabled={busy} />
            </Field>
          </div>

          {(progress || error) && (
            <div className={cn(
              "mt-4 rounded-xl px-4 py-3 text-sm font-semibold",
              error ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300",
            )}>
              {progress || error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-surface px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={onClose} disabled={busy}>{common("cancel")}</Button>
          <Button
            onClick={() => void uploadFiles()}
            disabled={files.length === 0 || Boolean(invalidFile)}
            loading={busy}
            className="gap-2"
          >
            {!busy && <Upload className="h-4 w-4" />}
            {t("upload")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function titleForFile(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "").trim();
  return withoutExtension || fileName;
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

async function requestJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "same-origin", ...init });
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T } | null;
  if (!response.ok || payload?.ok !== true) throw new Error("MEDIA_LIBRARY_REQUEST_FAILED");
  return payload.data as T;
}
