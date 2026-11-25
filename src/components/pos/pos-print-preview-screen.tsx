"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Printer, Share } from "lucide-react";
import { useHideMobileTabBar } from "@/components/mobile-tabbar-visibility";
import { useModalLayer } from "@/components/ui/use-modal-layer";

/**
 * Phone print preview after POS checkout, matching the native iOS
 * NativeReceiptDocumentPreviewView: full screen, "Close" on the left, centred
 * title, share and print on the right, and the document scaled to fit.
 * Printing itself is handed back to the caller (the regular POS print path).
 */
export function PosPrintPreviewScreen({
  children,
  onClose,
  onPrint,
  shareUrl,
  shareTitle,
}: {
  children: ReactNode;
  onClose: () => void;
  onPrint: () => void;
  /** Public print page of the saved document; temporary slips have none. */
  shareUrl?: string | null;
  shareTitle: string;
}) {
  const t = useTranslations();
  useHideMobileTabBar();
  const viewportRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const layerSurfaceRef = useRef<HTMLDivElement>(null);
  useModalLayer({ onEscape: onClose, elementRef: layerSurfaceRef });

  // A4/A5/K80 documents are sized in mm; shrink them to the phone width.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const doc = documentRef.current;
    if (!viewport || !doc) return;
    const fit = () => {
      const natural = doc.scrollWidth;
      const available = viewport.clientWidth - 24;
      setScale(natural > 0 ? Math.min(1, available / natural) : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const share = async () => {
    if (!shareUrl) return;
    const url = new URL(shareUrl, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, url });
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const iconButton = "grid size-11 place-items-center rounded-full bg-ios-card text-ios-accent shadow-sm ring-1 ring-black/5 disabled:opacity-40 dark:ring-white/10";

  return createPortal(
    <div ref={layerSurfaceRef} role="dialog" aria-modal="true" aria-label={t("print.previewTitle")} className="pos-print-preview-screen fixed inset-0 z-[120] flex flex-col bg-ios-grouped-bg lg:hidden">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-ios-inset pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} className="justify-self-start rounded-full bg-ios-card px-4 py-2.5 text-[17px] text-ios-accent shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          {t("common.close")}
        </button>
        <h1 className="truncate text-[17px] font-semibold">{t("print.previewTitle")}</h1>
        <div className="flex justify-self-end gap-2">
          <button type="button" onClick={() => void share()} disabled={!shareUrl} aria-label={t("print.shareBtn")} className={iconButton}>
            <Share className="size-5" />
          </button>
          <button type="button" onClick={onPrint} aria-label={t("print.printBtn")} className={iconButton}>
            <Printer className="size-5" />
          </button>
        </div>
      </header>
      <div ref={viewportRef} className="flex-1 overflow-auto overscroll-contain px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto w-fit bg-white shadow-md" style={{ zoom: scale }}>
          <div ref={documentRef} className="w-fit">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
