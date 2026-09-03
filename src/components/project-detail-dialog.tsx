"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

export function shouldCloseProjectDetailOnEscape(
  event: Pick<KeyboardEvent, "key" | "defaultPrevented">,
  dialog: Element | null,
  modalDialogs: readonly Element[],
) {
  return (
    event.key === "Escape" &&
    !event.defaultPrevented &&
    dialog !== null &&
    modalDialogs[modalDialogs.length - 1] === dialog
  );
}

export function ProjectDetailDialog({
  title,
  subtitle,
  closeLabel,
  children,
}: {
  title: string;
  subtitle: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modalDialogs = Array.from(
        document.querySelectorAll('[aria-modal="true"]'),
      );
      if (
        shouldCloseProjectDetailOnEscape(
          event,
          dialogRef.current,
          modalDialogs,
        )
      ) {
        close();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onMouseDown={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-detail-title"
        className="flex h-dvh w-full max-w-7xl flex-col overflow-hidden bg-surface shadow-2xl sm:h-[min(92dvh,920px)] sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2
              id="project-detail-title"
              className="truncate text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
            <p className="truncate text-sm text-slate-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 dark:hover:text-slate-200 lg:h-9 lg:w-9"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable_both-edges] [scrollbar-width:thin]">
          {children}
        </div>
      </div>
    </div>
  );
}
