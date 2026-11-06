"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

export function MergeOrdersDialog({
  title,
  closeLabel,
  children,
}: {
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      event.preventDefault();
      close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-orders-dialog-title"
        className="flex h-dvh w-full flex-col overflow-hidden bg-surface shadow-2xl sm:h-[calc(100dvh-2.5rem)] sm:w-[calc(100vw-2.5rem)] sm:max-w-none sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-6">
          <h2 id="merge-orders-dialog-title" className="min-w-0 truncate text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 dark:hover:text-slate-200 lg:h-9 lg:w-9"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
