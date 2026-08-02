"use client";

import { type ReactNode, useCallback, useEffect, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";

export function PrintPreviewModal({
  closeHref,
  children,
}: {
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const close = useCallback(() => router.push(closeHref), [closeHref, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useLayoutEffect(() => {
    document.querySelector<HTMLElement>(".print-document-root")?.scrollTo({ top: 0 });
  }, []);

  return (
    <div
      className="print-preview-modal fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:p-5"
      onMouseDown={close}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Xem trước bản in"
        className="print-preview-panel flex h-dvh w-full flex-col overflow-hidden bg-slate-200 shadow-2xl dark:bg-slate-950 sm:h-[min(94dvh,1100px)] sm:max-w-[1100px] sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}
