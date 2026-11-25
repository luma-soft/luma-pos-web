"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useModalLayer } from "@/components/ui/use-modal-layer";

export function PrintPreviewModal({
  closeHref,
  children,
}: {
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const close = useCallback(() => router.push(closeHref), [closeHref, router]);
  const layerSurfaceRef = useRef<HTMLElement>(null);
  useModalLayer({ onEscape: close, elementRef: layerSurfaceRef });

  useLayoutEffect(() => {
    document.querySelector<HTMLElement>(".print-document-root")?.scrollTo({ top: 0 });
  }, []);

  return (
    <div
      className="print-preview-modal fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:p-5"
      onMouseDown={close}
    >
      <section ref={layerSurfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label="Xem trước bản in"
        className="print-preview-panel flex h-dvh w-full max-w-7xl flex-col overflow-hidden bg-slate-200 shadow-2xl dark:bg-slate-950 sm:h-[min(92dvh,920px)] sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}
