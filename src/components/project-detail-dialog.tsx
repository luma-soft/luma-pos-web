"use client";

import { type ReactNode, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { useModalLayer } from "@/components/ui/use-modal-layer";

export function ProjectDetailDialog({
  title,
  subtitle,
  closeLabel,
  children,
  closeHref,
  backLabel,
  mobileActions,
}: {
  title: string;
  subtitle: ReactNode;
  closeLabel: string;
  children: ReactNode;
  closeHref?: string;
  /** Phone back button label (defaults to the close label). */
  backLabel?: string;
  /** Phone navigation-bar trailing control, e.g. the "…" menu. */
  mobileActions?: ReactNode;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    if (closeHref) router.replace(closeHref);
    else router.back();
  }, [closeHref, router]);

  useModalLayer({ onEscape: close, elementRef: dialogRef });

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
        className="flex h-dvh w-full max-w-[1600px] flex-col overflow-hidden bg-surface shadow-2xl sm:h-[min(92dvh,920px)] sm:rounded-2xl max-lg:h-dvh max-lg:rounded-none max-lg:bg-canvas max-lg:shadow-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Phones: iOS navigation bar — back, centred title, "…" menu. */}
        <div className="flex shrink-0 items-center gap-3 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] lg:hidden">
          <button
            type="button"
            onClick={close}
            aria-label={backLabel ?? closeLabel}
            data-button-radius="pill"
            className="grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 text-ios-label shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10"
          >
            <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h2 className="truncate text-[17px] font-semibold leading-[22px]">{title}</h2>
            <p className="truncate text-[13px] leading-[18px] text-ios-label-secondary">{subtitle}</p>
          </div>
          {mobileActions ?? <span className="size-11 shrink-0" aria-hidden="true" />}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-6 max-lg:hidden">
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
