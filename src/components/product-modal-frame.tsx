"use client";

import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useModalLayer } from "@/components/ui/use-modal-layer";

type ProductModalNavigation = "back" | "push" | "replace";
const ProductModalDismissContext = createContext<(() => void) | null>(null);
const ProductModalCloseContext = createContext<(() => void) | null>(null);

export function useDismissProductModalAfterSave() {
  return useContext(ProductModalDismissContext);
}

/** Closes the enclosing product modal the same way its close button does
 * (history back for intercepted routes, so the list keeps its filters). */
export function useCloseProductModal() {
  return useContext(ProductModalCloseContext);
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
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => setDismissed(true), []);
  const close = useCallback(() => {
    dismiss();
    if (closeNavigation === "back") router.back();
    else if (closeHref && closeNavigation === "push") router.push(closeHref);
    else if (closeHref) router.replace(closeHref);
  }, [closeHref, closeNavigation, dismiss, router]);

  const layer = useModalLayer({ open: !dismissed, onEscape: close, lockScroll: true, elementRef: dialogRef });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    dialog?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialog || !layer.isTop()) return;
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
      previous?.focus({ preventScroll: true });
    };
  }, [layer]);

  function onBackdropMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (closeOnBackdrop && event.target === event.currentTarget) close();
  }

  if (dismissed) return null;

  return (
    <ProductModalDismissContext.Provider value={dismiss}>
      <ProductModalCloseContext.Provider value={close}>
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
            "flex h-dvh w-full max-w-[1600px] flex-col overflow-hidden bg-surface pt-[env(safe-area-inset-top)] shadow-2xl outline-none sm:h-[min(92dvh,920px)] sm:rounded-2xl sm:pt-0",
            className,
          )}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </div>
      </ProductModalCloseContext.Provider>
    </ProductModalDismissContext.Provider>
  );
}
