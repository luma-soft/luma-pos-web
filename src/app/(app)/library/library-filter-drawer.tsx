"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Film, Folder, Image, LayoutGrid, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaLibrarySnapshot } from "@/lib/media/library-types";
import { cn } from "@/lib/utils";
import { LibraryDialog } from "./library-dialog";
import { libraryAlbumKey, libraryAlbumSelection, libraryListPath, libraryManualAlbums, libraryRequest, type LibraryAlbumSelection } from "./library-utils";

export type LibraryFilterSelection = LibraryAlbumSelection & { kind: string };

export function LibraryFilterDrawer({
  albums,
  allCount,
  initialResultCount,
  query,
  album,
  source = "",
  kind,
  onApply,
  onClose,
}: {
  albums: MediaLibrarySnapshot["albums"];
  allCount: number;
  initialResultCount: number;
  query: string;
  album: string;
  source?: LibraryAlbumSelection["source"];
  kind: string;
  onApply: (selection: LibraryFilterSelection) => void;
  onClose: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const [draft, setDraft] = useState<LibraryFilterSelection>({ album, source, kind });
  const [resultCount, setResultCount] = useState(initialResultCount);
  const [countLoading, setCountLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCountLoading(true);
      try {
        const next = await libraryRequest<MediaLibrarySnapshot>(
          libraryListPath(query, draft.album, draft.kind, null, draft.source),
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setResultCount(next.page?.totalItems ?? next.items.length);
        }
      } catch {
        // Keep the most recent valid count while the preview request retries.
      } finally {
        if (!controller.signal.aborted) setCountLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, query]);

  return (
    <LibraryDialog
      title={t("filterTitle")}
      placement="drawer"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setDraft({ album: "", source: "", kind: "" })}>
            {t("clearFilters")}
          </Button>
          <Button
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            {countLoading ? t("counting") : t("viewFiles", { count: resultCount })}
          </Button>
        </div>
      }
    >
      <div className="space-y-2 px-4 pt-5 sm:px-6">
        <p className="px-1 text-xs font-semibold text-slate-500">{t("fileType")}</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("fileType")}>
          {[
            { value: "", label: t("typeAll"), icon: LayoutGrid },
            { value: "image", label: t("types.image"), icon: Image },
            { value: "video", label: t("types.video"), icon: Film },
            { value: "document", label: t("types.document"), icon: FileText },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.kind === value}
              onClick={() => setDraft((current) => ({ ...current, kind: value }))}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-primary-600",
                draft.kind === value
                  ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"
                  : "border-border text-slate-600 hover:bg-surface-2 dark:text-slate-300",
              )}
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <LibraryAlbumOptions
        albums={albums}
        totalCount={allCount}
        selection={draft}
        onChange={(selection) => setDraft((current) => ({ ...current, ...selection }))}
      />
    </LibraryDialog>
  );
}

export function LibraryAlbumOptions({ albums, totalCount, selection, onChange }: {
  albums: MediaLibrarySnapshot["albums"];
  totalCount: number;
  selection: LibraryAlbumSelection;
  onChange: (selection: LibraryAlbumSelection) => void;
}) {
  const t = useTranslations("mediaLibrary");
  const groups = [
    { label: t("automatic"), entries: albums.filter((entry) => Boolean(entry.source)) },
    { label: t("manualAlbum"), entries: libraryManualAlbums(albums) },
  ];
  return <div className="min-w-0 space-y-5 px-4 py-5 sm:px-6" onKeyDown={(event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-album-option]"));
    const index = options.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    event.preventDefault();
    options[next]?.focus();
  }}>
    <button type="button" data-album-option aria-pressed={!selection.album && !selection.source}
      onClick={() => onChange({ album: "", source: "" })}
      className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary-600",
        !selection.album && !selection.source ? "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-200" : "text-slate-600 hover:bg-surface-2 dark:text-slate-300")}>
      <LayoutGrid aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{t("albumAll")}</span><span className="text-xs tabular-nums opacity-60">{totalCount}</span>
    </button>
    {groups.filter((group) => group.entries.length > 0).map((group) => <fieldset key={group.label} className="min-w-0">
      <legend className="mb-2 px-3 text-xs font-semibold text-slate-500">{group.label}</legend>
      <div className="space-y-1">{group.entries.map((entry) => {
        const active = entry.source ? selection.source === entry.source : !selection.source && selection.album === entry.name;
        const label = entry.source ? t(`sourceAlbums.${entry.source}`) : entry.name;
        return (
            <button
              key={libraryAlbumKey(entry)}
              type="button"
              data-album-option
              aria-pressed={active}
              onClick={() => onChange(libraryAlbumSelection(entry))}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-primary-600",
                active
                  ? "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"
                  : "text-slate-600 hover:bg-surface-2 dark:text-slate-300",
              )}
            >
              {entry.source ? (
                <Link2 aria-hidden="true" className="h-4 w-4 shrink-0" />
              ) : (
                <Folder aria-hidden="true" className="h-4 w-4 shrink-0" />
              )}
              <span
                className="min-w-0 flex-1 break-words py-2"
                title={label}
              >
                {label}
              </span>
              <span className="text-xs tabular-nums opacity-60">
                {entry.count}
              </span>
            </button>
        );
      })}</div>
    </fieldset>)}
    <p className="px-3 text-xs leading-5 text-slate-500">{t("linkedStorageHint")}</p>
  </div>;
}
