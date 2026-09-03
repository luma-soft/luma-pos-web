"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Folder, LayoutGrid, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaLibrarySnapshot } from "@/lib/media/library-types";
import { cn } from "@/lib/utils";
import { LibraryDialog } from "./library-dialog";
import { libraryAlbumKey, libraryAlbumSelection, libraryManualAlbums, type LibraryAlbumSelection } from "./library-utils";

export function LibraryFilterDrawer({
  albums,
  totalCount,
  album,
  source = "",
  onApply,
  onClose,
}: {
  albums: MediaLibrarySnapshot["albums"];
  totalCount: number;
  album: string;
  source?: LibraryAlbumSelection["source"];
  onApply: (selection: LibraryAlbumSelection) => void;
  onClose: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const common = useTranslations("common");
  const [draft, setDraft] = useState<LibraryAlbumSelection>({ album, source });

  return (
    <LibraryDialog
      title={t("filterTitle")}
      placement="drawer"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setDraft({ album: "", source: "" })}>
            {t("clearFilters")}
          </Button>
          <Button
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            {common("apply")}
          </Button>
        </div>
      }
    >
      <LibraryAlbumOptions albums={albums} totalCount={totalCount} selection={draft} onChange={setDraft} />
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
