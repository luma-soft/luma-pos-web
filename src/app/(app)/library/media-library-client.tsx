"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckCircle2,
  Check,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Images,
  LockKeyhole,
  LoaderCircle,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import {
  FilterTriggerButton,
  ListSearchFilterBar,
  ListSearchInput,
} from "@/components/list-search-filter";
import { Button } from "@/components/ui/button";
import { LumaImage } from "@/components/luma-image";
import type {
  MediaLibraryItem,
  MediaLibrarySnapshot,
} from "@/lib/media/library-types";
import { cn } from "@/lib/utils";
import { LibraryPreview } from "./library-preview";
import { LibraryFilterDrawer } from "./library-filter-drawer";
import { LibraryUploadDialog } from "./library-upload-dialog";
import {
  prepareLibraryImages,
  saveLibraryImages,
  shareLibraryImages,
} from "./library-image-actions";
import { useAppDataRevision } from "@/components/app-data-sync-provider";
import {
  libraryCanDelete,
  formatLibraryBytes,
  libraryImageDisplayUrl,
  libraryListPath,
  libraryManualAlbums,
  libraryRequest,
  type LibraryAlbumSelection,
} from "./library-utils";

export type LibraryNotice = { tone: "success" | "error"; text: string };
const kindIcons = { image: ImageIcon, video: Film, document: FileText };
const MAX_SELECTION = 20;
type SelectionAction = "saving" | "sharing" | "deleting";
type BatchDeleteResult = {
  deletedIds: string[];
  failed: Array<{ id: string; error: string }>;
};

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
  const dataRevision = useAppDataRevision();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [query, setQuery] = useState("");
  const [album, setAlbum] = useState("");
  const [source, setSource] = useState<LibraryAlbumSelection["source"]>("");
  const [kind, setKind] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = snapshot.items.find((item) => item.id === previewId) ?? null;
  const [loading, setLoading] = useState(false);
  const [appending, setAppending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [appendFailed, setAppendFailed] = useState(false);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);
  const [libraryTotal, setLibraryTotal] = useState(
    initialSnapshot.page?.totalItems ?? initialSnapshot.items.length,
  );
  const [libraryBytes, setLibraryBytes] = useState(initialSnapshot.usage.totalBytes);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [selectionProgress, setSelectionProgress] = useState({ completed: 0, total: 0 });
  const requestVersion = useRef(0);
  const initialRender = useRef(true);
  const loadMoreTarget = useRef<HTMLDivElement>(null);
  const requestedCursor = useRef<string | null>(null);

  const load = useCallback(
    async (cursor?: string | null) => {
      const version = ++requestVersion.current;
      if (!cursor) requestedCursor.current = null;
      setLoading(true);
      setAppending(Boolean(cursor));
      if (cursor) setAppendFailed(false);
      else setLoadFailed(false);
      try {
        const next = await libraryRequest<MediaLibrarySnapshot>(
          libraryListPath(query, album, kind, cursor, source),
        );
        if (version !== requestVersion.current) return;
        if (!cursor && !query.trim() && !album && !source && !kind) {
          setLibraryTotal(next.page?.totalItems ?? next.items.length);
        }
        setLibraryBytes(next.usage.totalBytes);
        if (!cursor) {
          const visible = new Set(next.items.map((item) => item.id));
          setSelectedIds((current) => {
            if (current.size === 0) return current;
            const selected = new Set([...current].filter((id) => visible.has(id)));
            return selected.size === current.size ? current : selected;
          });
        }
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
        if (cursor) setAppendFailed(true);
        else setLoadFailed(true);
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
  }, [load, dataRevision]);
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

  useEffect(() => {
    if (selectedIds.size === 0 || selectionAction) return;
    const exitSelection = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIds(new Set());
    };
    document.addEventListener("keydown", exitSelection);
    return () => document.removeEventListener("keydown", exitSelection);
  }, [selectedIds.size, selectionAction]);

  useEffect(() => {
    const target = loadMoreTarget.current;
    const cursor = snapshot.page?.nextCursor ?? null;
    if (!target || !cursor || !snapshot.page?.hasMore || loadFailed || appendFailed) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || loading || requestedCursor.current === cursor) return;
        requestedCursor.current = cursor;
        void load(cursor);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [appendFailed, load, loadFailed, loading, snapshot.page?.hasMore, snapshot.page?.nextCursor]);

  function toggleSelection(item: MediaLibraryItem) {
    if (item.kind !== "image" || selectionAction) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.delete(item.id)) return next;
      if (next.size >= MAX_SELECTION) {
        setNotice({ tone: "error", text: t("selectionLimit") });
        return current;
      }
      next.add(item.id);
      return next;
    });
  }

  const selectedItems = snapshot.items.filter((item) => selectedIds.has(item.id));
  const canDeleteSelection = selectedItems.length > 0 &&
    selectedItems.every((item) => libraryCanDelete(item, snapshot.canManage));

  async function refreshLibrarySummary() {
    const next = await libraryRequest<MediaLibrarySnapshot>(
      libraryListPath("", "", "", null, ""),
    );
    setLibraryTotal(next.page?.totalItems ?? next.items.length);
    setLibraryBytes(next.usage.totalBytes);
  }

  async function exportSelection(mode: "save" | "share") {
    if (selectionAction || selectedItems.length === 0) return;
    const items = [...selectedItems];
    setSelectionAction(mode === "save" ? "saving" : "sharing");
    setSelectionProgress({ completed: 0, total: items.length });
    try {
      const prepared = await prepareLibraryImages(items, (completed, total) => {
        setSelectionProgress({ completed, total });
      });
      if (prepared.files.length === 0) {
        setNotice({
          tone: "error",
          text: t(mode === "save" ? "saveResult" : "shareResult", {
            success: 0,
            failed: prepared.failed,
          }),
        });
        return;
      }
      if (mode === "save") {
        await saveLibraryImages(prepared.files);
      } else {
        const shared = await shareLibraryImages(prepared.files);
        if (!shared) return;
      }
      setNotice({
        tone: prepared.failed > 0 ? "error" : "success",
        text: t(mode === "save" ? "saveResult" : "shareResult", {
          success: prepared.files.length,
          failed: prepared.failed,
        }),
      });
      if (prepared.files.length > 0) setSelectedIds(new Set());
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error && error.message === "SHARE_UNAVAILABLE"
          ? t("shareUnavailable")
          : t(mode === "save" ? "errors.save" : "errors.share"),
      });
    } finally {
      setSelectionAction(null);
      setSelectionProgress({ completed: 0, total: 0 });
    }
  }

  async function deleteSelection() {
    if (selectionAction || !canDeleteSelection) return;
    const items = [...selectedItems];
    const confirmed = await confirmDialog.confirm({
      title: t("deleteSelectedTitle", { count: items.length }),
      description: t("deleteSelectedDescription", { count: items.length }),
      confirmLabel: common("delete"),
      cancelLabel: common("cancel"),
      variant: "destructive",
    });
    if (!confirmed) return;
    setSelectionAction("deleting");
    setSelectionProgress({ completed: 0, total: items.length });
    try {
      const result = await libraryRequest<BatchDeleteResult>("/api/mobile/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-many", ids: items.map((item) => item.id) }),
      });
      setSelectionProgress({ completed: items.length, total: items.length });
      setNotice({
        tone: result.failed.length > 0 ? "error" : "success",
        text: t("deleteResult", {
          success: result.deletedIds.length,
          failed: result.failed.length,
        }),
      });
      setLibraryTotal((current) => Math.max(0, current - result.deletedIds.length));
      setSelectedIds(new Set());
      if (result.deletedIds.length > 0) await load();
    } catch {
      setNotice({ tone: "error", text: t("errors.delete") });
    } finally {
      setSelectionAction(null);
      setSelectionProgress({ completed: 0, total: 0 });
    }
  }

  async function removeItem(item: MediaLibraryItem) {
    if (!libraryCanDelete(item, snapshot.canManage)) return;
    setPreviewId(null);
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
      setLibraryTotal((current) => Math.max(0, current - 1));
      await load();
    } catch {
      setNotice({ tone: "error", text: t("errors.delete") });
    }
  }

  const filtered = Boolean(query || album || kind || source);
  const total = snapshot.page?.totalItems ?? snapshot.items.length;
  return (
    <div className={cn("min-h-full bg-canvas", selectedIds.size > 0 && "pb-24")}>
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
              <p className="mt-1.5 text-xs tabular-nums text-slate-500 sm:text-sm dark:text-slate-400">
                {t("storageUsage", {
                  count: libraryTotal,
                  size: formatLibraryBytes(libraryBytes, locale),
                })}
              </p>
            </div>
            {snapshot.canManage && (
              <Button
                disabled={Boolean(selectionAction)}
                onClick={() => setUploadOpen(true)}
                className="shrink-0 gap-2"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("upload")}</span>
                <span className="sm:hidden">{t("addShort")}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] py-3 sm:px-4 lg:px-6">
        <div className="min-w-0 space-y-4">
          <section aria-label={t("filters")} className="px-3 sm:px-0">
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
                    active={Boolean(album || source || kind)}
                    resultCount={filtered ? total : undefined}
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
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface text-slate-500 transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary-600 disabled:opacity-50"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </button>
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
          {loading && !appending ? (
            <div
              aria-busy="true"
              aria-label={t("loading")}
              className="grid min-h-[calc(100dvh-13rem)] grid-cols-3 content-start gap-0.5 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8"
            >
              {Array.from({ length: 40 }, (_, index) => (
                <div key={index} className="aspect-square animate-pulse bg-surface-2" />
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
              className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8"
            >
              {snapshot.items.map((item) => (
                <LibraryTile
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  selecting={selectedIds.size > 0}
                  deleteLocked={snapshot.canManage && !libraryCanDelete(item, true)}
                  onOpen={() => {
                    if (selectedIds.size > 0 && item.kind === "image") toggleSelection(item);
                    else setPreviewId(item.id);
                  }}
                  onToggle={() => toggleSelection(item)}
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
          <div ref={loadMoreTarget} aria-hidden="true" className="h-1" />
          {appending && (
            <div role="status" aria-label={t("loading")} className="grid h-14 place-items-center">
              <LoaderCircle className="h-5 w-5 animate-spin text-primary-600" />
            </div>
          )}
          {appendFailed && snapshot.page?.nextCursor && (
            <div className="flex justify-center py-3">
              <Button
                variant="outline"
                onClick={() => {
                  requestedCursor.current = null;
                  void load(snapshot.page?.nextCursor);
                }}
              >
                {t("retry")}
              </Button>
            </div>
          )}
        </div>
      </div>
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 px-3">
          <div className="mx-auto flex max-w-2xl items-center gap-1 rounded-2xl border border-border bg-surface/95 p-2 shadow-e2 backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              aria-label={common("cancel")}
              disabled={Boolean(selectionAction)}
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-4 w-4" />
            </Button>
            <span className="hidden shrink-0 px-2 text-sm font-semibold sm:block">
              {t("selectionCount", { count: selectedIds.size })}
            </span>
            {selectionAction && (
              <div className="min-w-0 flex-1 px-3 text-xs text-slate-500">
                <p className="truncate">{t(selectionAction)}</p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-primary-600 transition-[width]"
                    style={{ width: `${selectionProgress.total ? (selectionProgress.completed / selectionProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
            {!selectionAction && (
              <>
                <Button variant="ghost" className="min-w-0 flex-1 gap-2" onClick={() => void exportSelection("save")}>
                  <Download className="h-4 w-4" />
                  {t("saveImages")}
                </Button>
                <Button variant="ghost" className="min-w-0 flex-1 gap-2" onClick={() => void exportSelection("share")}>
                  <Share2 className="h-4 w-4" />
                  {t("shareImages")}
                </Button>
                {snapshot.canManage && (
                  <Button
                    variant="ghost"
                    disabled={!canDeleteSelection}
                    title={!canDeleteSelection ? t("deleteUnavailable") : undefined}
                    className="min-w-0 flex-1 gap-2 text-red-600 disabled:text-slate-400"
                    onClick={() => void deleteSelection()}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("deleteImages")}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {filterOpen && (
        <LibraryFilterDrawer
          albums={snapshot.albums}
          allCount={libraryTotal}
          initialResultCount={total}
          query={query}
          album={album}
          source={source}
          kind={kind}
          onApply={(selection) => {
            setAlbum(selection.album);
            setSource(selection.source);
            setKind(selection.kind);
          }}
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
            if (filtered) await refreshLibrarySummary();
          }}
        />
      )}
      {preview && (
        <LibraryPreview
          item={preview}
          canManage={snapshot.canManage}
          onClose={() => setPreviewId(null)}
          onDelete={() => void removeItem(preview)}
        />
      )}
    </div>
  );
}

export function LibraryTile({
  item,
  selected,
  selecting,
  deleteLocked,
  onOpen,
  onToggle,
}: {
  item: MediaLibraryItem;
  selected: boolean;
  selecting: boolean;
  deleteLocked: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const Icon = kindIcons[item.kind];
  return (
    <article className="group relative aspect-square min-w-0 overflow-hidden bg-surface-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${t("open")}: ${item.title}`}
        className={cn(
          "relative block h-full min-h-11 min-w-11 w-full overflow-hidden focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600",
          selected && "ring-4 ring-inset ring-primary-600",
        )}
      >
        {item.kind === "image" ? (
          <LumaImage
            unoptimized
            fill
            src={libraryImageDisplayUrl(item)}
            alt={item.title}
            sizes="(max-width: 640px) 34vw, (max-width: 1024px) 25vw, 17vw"
            containerClassName="absolute inset-0"
            className="object-cover group-hover:scale-[1.02]"
            fallbackLabel={t("errors.load")}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface-2 p-4 text-slate-400">
            <Icon className="h-10 w-10 stroke-[1.3]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              {item.fileName.split(".").pop()}
            </span>
          </div>
        )}
      </button>
      {item.kind === "image" && (
        <button
          type="button"
          aria-label={selected ? t("deselectImage", { title: item.title }) : t("selectImage", { title: item.title })}
          aria-pressed={selected}
          onClick={onToggle}
          className={cn(
            "absolute right-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-full border-2 border-white text-white shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600",
            selected
              ? "bg-primary-600 opacity-100"
              : selecting
                ? "bg-slate-950/20 opacity-100"
                : "bg-slate-950/20 opacity-0 group-hover:opacity-100 focus:opacity-100",
          )}
        >
          {selected && <Check className="h-4 w-4 stroke-[3]" />}
        </button>
      )}
      {item.kind === "image" && selecting && deleteLocked && (
        <span
          title={t("deleteUnavailable")}
          className="absolute bottom-2 left-2 z-20 grid h-7 w-7 place-items-center rounded-full bg-slate-950/60 text-white"
        >
          <LockKeyhole className="h-3.5 w-3.5" />
        </span>
      )}
    </article>
  );
}
