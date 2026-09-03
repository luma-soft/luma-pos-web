"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The native modal top layer provides inert background and keyboard focus containment. */
export function LibraryDialog({
  title,
  description,
  children,
  footer,
  busy = false,
  wide = false,
  placement = "center",
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  wide?: boolean;
  placement?: "center" | "drawer";
  onClose: () => void;
}) {
  const common = useTranslations("common");
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
      className={cn(
        "fixed inset-0 hidden h-dvh max-h-dvh w-full flex-col overflow-hidden border-0 bg-surface p-0 text-foreground shadow-e2 backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px] open:flex",
        placement === "drawer"
          ? "m-0 ml-auto max-w-[460px]"
          : "m-auto max-w-none sm:h-fit sm:max-h-[calc(100dvh-4rem)] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-border",
        placement === "center" && wide && "sm:max-w-5xl",
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2
            id={titleId}
            title={title}
            className="max-w-[36ch] truncate text-lg font-bold tracking-tight sm:text-xl"
          >
            {title}
          </h2>
          {description && (
            <p
              id={descriptionId}
              className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400"
            >
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={common("close")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-40"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
      {footer && (
        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          {footer}
        </footer>
      )}
    </dialog>,
    document.body,
  );
}
