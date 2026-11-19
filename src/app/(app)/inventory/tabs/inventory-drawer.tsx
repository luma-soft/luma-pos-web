"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { useHideMobileTabBar } from "@/components/mobile-tabbar-visibility";
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
  mobileSubtitle,
  mobileSubtitleClassName,
  footerClassName,
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
  /** Phones: caption under the centred title (e.g. "1 SKU"), like a pushed iOS screen. */
  mobileSubtitle?: string;
  mobileSubtitleClassName?: string;
  footerClassName?: string;
}) {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  useHideMobileTabBar();
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
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

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
        {/* Phones: pushed-screen bar with the back circle and a centred title + caption. */}
        <header className="grid shrink-0 grid-cols-[48px_minmax(0,1fr)_48px] items-center gap-2 px-ios-inset pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] lg:hidden">
          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            data-button-radius="pill"
            className="grid size-12 place-items-center rounded-full border border-ios-stroke/40 bg-surface shadow-[0_2px_10px_rgb(0_0_0/0.08)] active:opacity-60"
          >
            <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
          </button>
          <div className="min-w-0 text-center">
            <h2 className="truncate text-[17px] font-semibold">{title}</h2>
            {(mobileSubtitle ?? subtitle) && <p className={cn("truncate text-[12px] text-ios-label-secondary", mobileSubtitleClassName)}>{mobileSubtitle ?? subtitle}</p>}
          </div>
          <span aria-hidden="true" />
        </header>
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4 max-lg:hidden">
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
        {footer && <footer className={cn("shrink-0 border-t border-border bg-surface px-5 py-3", footerClassName)}>{footer}</footer>}
      </aside>
    </div>
  );
}
