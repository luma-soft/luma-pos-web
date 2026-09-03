"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckCircle2,
  ChevronDown,
  FileText,
  Film,
  HardDrive,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  Link2,
  LockKeyhole,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import {
  FilterTriggerButton,
  ListSearchFilterBar,
  ListSearchInput,
} from "@/components/list-search-filter";
import { Button } from "@/components/ui/button";
import type {
  MediaLibraryItem,
  MediaLibrarySnapshot,
} from "@/lib/media/library-types";
import { cn } from "@/lib/utils";
import { LibraryPreview } from "./library-preview";
import { LibraryFilterDrawer } from "./library-filter-drawer";
import { LibraryUploadDialog } from "./library-upload-dialog";
import {
  formatLibraryBytes,
  libraryCanDelete,
  libraryItemSizeKnown,
  libraryItemSourcePreset,
  libraryListPath,
  libraryManualAlbums,
  libraryRequest,
  type LibraryAlbumSelection,
} from "./library-utils";

export type LibraryNotice = { tone: "success" | "error"; text: string };
const kindIcons = { image: ImageIcon, video: Film, document: FileText };

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
  const confirmDialog = useConfirmDialog();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [query, setQuery] = useState("");
  const [album, setAlbum] = useState("");
  const [source, setSource] = useState<LibraryAlbumSelection["source"]>("");
  const [kind, setKind] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<MediaLibraryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [appending, setAppending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);
  const requestVersion = useRef(0);
  const initialRender = useRef(true);

  const load = useCallback(
    async (cursor?: string | null) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setAppending(Boolean(cursor));
      setLoadFailed(false);
      try {
        const next = await libraryRequest<MediaLibrarySnapshot>(
          libraryListPath(query, album, kind, cursor, source),
        );
        if (version !== requestVersion.current) return;
        setSnapshot((current) => ({
          ...next,
          items: cursor
            ? [
                ...current.items,
                ...next.items.filter(
                  (item) => !current.items.some((old) => old.id === item.id),
                ),
              ]
            : next.items,
        }));
      } catch {
        if (version !== requestVersion.current) return;
        setLoadFailed(true);
      } finally {
        if (version === requestVersion.current) {
          setLoading(false);
          setAppending(false);
        }
      }
    },
    [query, album, kind, source],
  );

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    requestVersion.current += 1;
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (notice?.tone !== "success") return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function removeItem(item: MediaLibraryItem) {
    if (!libraryCanDelete(item, snapshot.canManage)) return;
    setPreview(null);
    const confirmed = await confirmDialog.confirm({
      title: t("deleteTitle"),
      description: t("deleteDescription", { title: item.title }),
      confirmLabel: common("delete"),
      cancelLabel: common("cancel"),
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await libraryRequest(
        `/api/mobile/library?id=${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      await load();
    } catch {
      setNotice({ tone: "error", text: t("errors.delete") });
    }
  }

  const filtered = Boolean(query || album || kind || source);
  const total = snapshot.page?.totalItems ?? snapshot.items.length;
  return (
    <div className="min-h-full bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <Images className="h-5 w-5 shrink-0 text-primary-600" />
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  {t("title")}
                </h1>
              </div>
              <p className="mt-1.5 hidden text-sm text-slate-500 sm:block dark:text-slate-400">
                {t("subtitle")}
              </p>
            </div>
            {snapshot.canManage && (
              <Button
                onClick={() => setUploadOpen(true)}
                className="shrink-0 gap-2"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("upload")}</span>
                <span className="sm:hidden">{t("addShort")}</span>
              </Button>
            )}
          </div>
          <details className="group mt-2 text-xs text-slate-500 dark:text-slate-400">
            <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-primary-600 [&::-webkit-details-marker]:hidden">
              <HardDrive className="h-3.5 w-3.5" />
              <span className="tabular-nums">
                {t("uploadedUsage", { count: snapshot.usage.libraryObjects, size: formatLibraryBytes(snapshot.usage.libraryBytes, locale) })}
              </span>
              <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
              <span className="sr-only">{t("storageDetails")}</span>
            </summary>
            <div className="flex flex-col gap-2 rounded-lg bg-surface-2 px-3 py-3 sm:flex-row sm:gap-6">
              <span>
                {t("usageTotal")}:{" "}
                <strong className="font-semibold tabular-nums">
                  {formatLibraryBytes(snapshot.usage.totalBytes, locale)}
                </strong>{" "}
                · {t("itemsCount", { count: snapshot.usage.totalObjects })}
              </span>
              <span>{t("unlimitedHint")}</span>
              <span className="flex items-center gap-1.5">
                <LockKeyhole className="h-3 w-3" />
                {t("privateShort")}
              </span>
            </div>
            <p className="mt-2 max-w-3xl leading-5">{t("linkedStorageHint")}</p>
          </details>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6 lg:px-8 lg:py-6">
        <div className="min-w-0 space-y-4">
          <section aria-label={t("filters")} className="space-y-3">
            <div className="flex items-center gap-2">
              <ListSearchFilterBar
                search={
                  <ListSearchInput
                    placeholder={t("searchPlaceholder")}
                    value={query}
                    maxLength={200}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                }
                filter={
                  <FilterTriggerButton
                    label={t("filterButton")}
                    active={Boolean(album || source)}
                    aria-haspopup="dialog"
                    aria-expanded={filterOpen}
                    onClick={() => setFilterOpen(true)}
                  />
                }
              />
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                aria-label={common("refresh")}
                title={common("refresh")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-surface text-slate-500 transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-border">
              <div
                className="flex min-w-0 gap-1 overflow-x-auto"
                role="group"
                aria-label={t("typeAll")}
              >
                {[
                  { value: "", label: t("allShort"), icon: LayoutGrid },
                  ...(["image", "video", "document"] as const).map((value) => ({
                    value,
                    label: t(`types.${value}`),
                    icon: kindIcons[value],
                  })),
                ].map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => setKind(value)}
                    className={cn(
                      "relative flex min-h-11 min-w-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-2.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-primary-600 sm:px-3 sm:text-sm",
                      kind === value
                        ? "border-primary-600 text-primary-700 dark:text-primary-300"
                        : "border-transparent text-slate-500 hover:text-foreground",
                    )}
                  >
                    <Icon className="hidden h-4 w-4 sm:block" />
                    {label}
                  </button>
                ))}
              </div>
              <span className="hidden text-xs tabular-nums text-slate-500 sm:block">
                {t("itemsCount", { count: total })}
              </span>
            </div>
          </section>
          {notice && (
            <div
              role={notice.tone === "error" ? "alert" : "status"}
              className={cn(
                "flex items-center gap-2 rounded-lg pl-3 text-sm",
                notice.tone === "success"
                  ? "bg-ok-soft text-ok"
                  : "bg-er-soft text-er",
              )}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="flex-1 py-2">{notice.text}</span>
              <button
                type="button"
                aria-label={common("close")}
                onClick={() => setNotice(null)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg focus-visible:outline-2"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {filtered && (
            <div className="flex min-h-11 items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {source ? t(`sourceAlbums.${source}`) : album || t("albumAll")} · {t("itemsCount", { count: total })}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAlbum("");
                  setSource("");
                  setKind("");
                  setQuery("");
                }}
                className="min-h-11 min-w-11 rounded-lg px-2 font-semibold text-primary-600 hover:bg-primary-50"
              >
                {common("clear")}
              </button>
            </div>
          )}
          {source && <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><Link2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t("sourceReadOnlyHint")}</p>}
          {loading && !appending ? (
            <div
              aria-busy="true"
              aria-label={t("loading")}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
            >
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="motion-safe:animate-pulse">
                  <div className="aspect-[4/3] rounded-xl bg-surface-2" />
                  <div className="mt-3 h-3 w-3/4 rounded bg-surface-2" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : loadFailed ? (
            <div role="alert" className="py-16 text-center">
              <p className="text-sm text-slate-500">{t("errors.load")}</p>
              <Button
                variant="outline"
                onClick={() => void load()}
                className="mt-4"
              >
                {t("retry")}
              </Button>
            </div>
          ) : snapshot.items.length > 0 ? (
            <section
              aria-label={t("title")}
              className="grid grid-cols-2 items-start gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-4 xl:grid-cols-4"
            >
              {snapshot.items.map((item) => (
                <LibraryTile
                  key={item.id}
                  item={item}
                  locale={locale}
                  onOpen={() => setPreview(item)}
                />
              ))}
            </section>
          ) : (
            <section className="grid min-h-72 place-items-center rounded-xl border border-dashed border-border px-5 text-center">
              <div className="max-w-sm py-12">
                <Images className="mx-auto mb-4 h-9 w-9 text-primary-600" />
                <h2 className="text-base font-semibold">
                  {t(filtered ? "noResultsTitle" : "emptyTitle")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {t(filtered ? "noResultsDescription" : "emptyDescription")}
                </p>
                {!filtered && snapshot.canManage && (
                  <Button
                    onClick={() => setUploadOpen(true)}
                    className="mt-5 gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    {t("upload")}
                  </Button>
                )}
              </div>
            </section>
          )}
          {snapshot.page?.hasMore && !loadFailed && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                loading={loading}
                onClick={() => void load(snapshot.page?.nextCursor)}
              >
                {t("loadMore")}
              </Button>
            </div>
          )}
        </div>
      </div>
      {filterOpen && (
        <LibraryFilterDrawer
          albums={snapshot.albums}
          totalCount={snapshot.albums.reduce((count, entry) => count + entry.count, 0)}
          album={album}
          source={source}
          onApply={(selection) => { setAlbum(selection.album); setSource(selection.source); }}
          onClose={() => setFilterOpen(false)}
        />
      )}
      {uploadOpen && (
        <LibraryUploadDialog
          storeId={storeId}
          albums={libraryManualAlbums(snapshot.albums).map((entry) => entry.name)}
          initialAlbum={source ? "" : album}
          onClose={() => setUploadOpen(false)}
          onUploaded={async (message) => {
            setNotice(message);
            await load();
          }}
        />
      )}
      {preview && (
        <LibraryPreview
          item={preview}
          canManage={snapshot.canManage}
          onClose={() => setPreview(null)}
          onDelete={() => void removeItem(preview)}
        />
      )}
    </div>
  );
}

export function LibraryTile({
  item,
  locale,
  onOpen,
}: {
  item: MediaLibraryItem;
  locale: string;
  onOpen: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const Icon = kindIcons[item.kind];
  const preset = libraryItemSourcePreset(item);
  return (
    <article className="group min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${t("open")}: ${item.title}`}
        className="relative block aspect-[4/3] min-h-11 min-w-11 w-full overflow-hidden rounded-xl border border-border bg-surface transition hover:border-primary-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
      >
        {item.kind === "image" ? (
          <NextImage
            unoptimized
            fill
            src={item.thumbnailUrl ?? item.url}
            alt={item.title}
            sizes="(max-width: 640px) 50vw, (max-width: 1280px) 30vw, 22vw"
            className="object-contain p-2 transition duration-200 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface-2 p-4 text-slate-400">
            <Icon className="h-10 w-10 stroke-[1.3]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              {item.fileName.split(".").pop()}
            </span>
          </div>
        )}
        {item.source && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-surface/95 px-1.5 py-1 text-[10px] font-medium text-primary-700 shadow-sm dark:text-primary-300"><Link2 aria-hidden="true" className="h-3 w-3" />{t("automatic")}</span>}
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-surface/95 px-1.5 py-1 text-[10px] font-medium text-slate-600 shadow-sm dark:text-slate-300">
          {item.kind === "video" ? (
            <Play className="h-3 w-3" />
          ) : (
            <Icon className="h-3 w-3" />
          )}
          {t(`types.${item.kind}`)}
        </span>
      </button>
      <div className="px-0.5 pt-2.5">
        <h2
          className="truncate text-[13px] font-semibold sm:text-sm"
          title={item.title}
        >
          {item.title}
        </h2>
        <p className="mt-1 truncate text-[11px] text-slate-500 sm:text-xs">
          {preset ? t(`sourceAlbums.${preset}`) : item.album} <span className="px-0.5 opacity-50">·</span>{" "}
          <span className="tabular-nums">
            {libraryItemSizeKnown(item) ? formatLibraryBytes(item.sizeBytes, locale) : t("unknownSize")}
          </span>
        </p>
        {item.source && <p className="mt-1 truncate text-[11px] text-slate-500" title={t("linkedSource", { source: item.source.label })}>{t("linkedSource", { source: item.source.label })}</p>}
      </div>
    </article>
  );
}
