"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function InventoryDrawer({
  title,
  subtitle,
  ariaLabel,
  icon,
  closeLabel,
  closeHref,
  onClose,
  children,
  footer,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  icon: ReactNode;
  closeLabel: string;
  closeHref?: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
}) {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  const closeRef = useRef<() => void>(() => {});
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isClosingRef = useRef(false);
  const close = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsVisible(false);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (closeHref) {
        router.push(closeHref, { scroll: false });
      } else {
        onClose?.();
      }
    }, prefersReducedMotion ? 0 : 300);
  }, [closeHref, onClose, router]);
  closeRef.current = close;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => setIsVisible(true));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[80] transition-opacity duration-300 ease-out motion-reduce:duration-0",
        isVisible ? "bg-slate-950/30 opacity-100" : "bg-slate-950/0 opacity-0",
      )}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) closeRef.current();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="ml-auto flex h-full w-full max-w-[1040px] flex-col bg-surface shadow-2xl transition-[transform] duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: isVisible ? "translateX(0)" : "translateX(100%)" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950/40">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
        {footer && <footer className="shrink-0 border-t border-border bg-surface px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}
