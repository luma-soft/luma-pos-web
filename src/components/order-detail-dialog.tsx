"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";

export function OrderDetailDialog({
  orderId,
  title,
  subtitle,
  children,
}: {
  orderId: string;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const isOpen = searchParams.get("detailOrderId") === orderId;
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("detailOrderId") !== orderId) return;

    // URL-only change: do not navigate/re-fetch the server-rendered list on close.
    // Passing null lets Next.js sync useSearchParams and preserve its router state.
    url.searchParams.delete("detailOrderId");
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [orderId]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      // Consume Escape before the customer/history modal underneath handles it.
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [close, isOpen]);

  // The server-rendered parallel route can remain mounted after a shallow URL update.
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onMouseDown={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
        className="flex h-dvh w-full max-w-[1600px] flex-col overflow-hidden bg-surface shadow-2xl sm:h-[min(92dvh,920px)] sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id="order-detail-title" className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p className="truncate text-sm text-slate-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Đóng chi tiết hóa đơn"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 dark:hover:text-slate-200 lg:h-9 lg:w-9"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
