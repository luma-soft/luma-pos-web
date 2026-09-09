"use client";

import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type ProductModalNavigation = "back" | "push" | "replace";

export function shouldHandleProductModalEscape(
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

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
}

export function ProductModalFrame({
  labelledBy,
  children,
  closeHref,
  closeNavigation = closeHref ? "replace" : "back",
  closeOnBackdrop = false,
  className,
}: {
  labelledBy: string;
  children: ReactNode;
  closeHref?: string;
  closeNavigation?: ProductModalNavigation;
  closeOnBackdrop?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    if (closeNavigation === "back") router.back();
    else if (closeHref && closeNavigation === "push") router.push(closeHref);
    else if (closeHref) router.replace(closeHref);
  }, [closeHref, closeNavigation, router]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      const modalDialogs = Array.from(document.querySelectorAll('[aria-modal="true"]'));
      if (shouldHandleProductModalEscape(event, dialog, modalDialogs)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || modalDialogs[modalDialogs.length - 1] !== dialog || !dialog) return;
      const elements = focusableElements(dialog);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus({ preventScroll: true });
    };
  }, [close]);

  function onBackdropMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (closeOnBackdrop && event.target === event.currentTarget) close();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          "flex h-dvh w-full max-w-7xl flex-col overflow-hidden bg-surface shadow-2xl outline-none sm:h-[min(92dvh,920px)] sm:rounded-2xl",
          className,
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
