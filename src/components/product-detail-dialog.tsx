"use client";

import { type ReactNode, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

export function ProductDetailDialog({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const close = useCallback(() => {
    router.back();
  }, [router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        className="flex max-h-[94dvh] w-full max-w-7xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id="product-detail-title" className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p className="truncate text-sm text-slate-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Đóng chi tiết sản phẩm"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-surface-2 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
