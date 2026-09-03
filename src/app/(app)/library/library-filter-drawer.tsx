"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Folder, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaLibrarySnapshot } from "@/lib/media/library-types";
import { cn } from "@/lib/utils";
import { LibraryDialog } from "./library-dialog";

export function LibraryFilterDrawer({
  albums,
  totalCount,
  album,
  onApply,
  onClose,
}: {
  albums: MediaLibrarySnapshot["albums"];
  totalCount: number;
  album: string;
  onApply: (album: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("mediaLibrary");
  const common = useTranslations("common");
  const [draftAlbum, setDraftAlbum] = useState(album);

  return (
    <LibraryDialog
      title={t("filterTitle")}
      placement="drawer"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setDraftAlbum("")}>
            {t("clearFilters")}
          </Button>
          <Button
            onClick={() => {
              onApply(draftAlbum);
              onClose();
            }}
          >
            {common("apply")}
          </Button>
        </div>
      }
    >
      <fieldset className="min-w-0 px-4 py-5 sm:px-6">
        <legend className="float-left mb-3 w-full text-sm font-semibold">
          {t("albumsTitle")}
        </legend>
        <div className="clear-both space-y-1">
          {[{ name: "", count: totalCount }, ...albums].map((entry) => (
            <button
              key={entry.name}
              type="button"
              aria-pressed={draftAlbum === entry.name}
              onClick={() => setDraftAlbum(entry.name)}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-primary-600",
                draftAlbum === entry.name
                  ? "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"
                  : "text-slate-600 hover:bg-surface-2 dark:text-slate-300",
              )}
            >
              {entry.name ? (
                <Folder className="h-4 w-4 shrink-0" />
              ) : (
                <LayoutGrid className="h-4 w-4 shrink-0" />
              )}
              <span
                className="min-w-0 flex-1 break-words py-2"
                title={entry.name || t("albumAll")}
              >
                {entry.name || t("albumAll")}
              </span>
              <span className="text-xs tabular-nums opacity-60">
                {entry.count}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
    </LibraryDialog>
  );
}
