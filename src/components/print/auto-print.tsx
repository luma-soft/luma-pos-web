"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useModalClose } from "@/components/use-modal-close";
import { waitForPrintImages } from "@/lib/print/wait-for-images";

export function AutoPrint({ closeHref, printTitle }: { closeHref: string; printTitle?: string }) {
  // After printing, go back to the screen that opened the print page (a
  // detail modal, a filtered list); `closeHref` only when there is none.
  const closeToOpener = useModalClose(closeHref, { anyOpener: true });
  const searchParams = useSearchParams();

  useEffect(() => {
    const previousDocumentTitle = document.title;
    if (printTitle) document.title = printTitle;
    const restoreDocumentTitle = () => {
      document.title = previousDocumentTitle;
    };
    if (searchParams.get("embedded") === "1") {
      let cancelled = false;
      void waitForPrintImages(document.querySelectorAll<HTMLImageElement>(".print-document-root img")).then(() => {
        if (cancelled) return;
        window.parent.postMessage({ type: "luma-print-ready" }, window.location.origin);
      });
      return () => {
        cancelled = true;
        restoreDocumentTitle();
      };
    }
    const close = () => {
      restoreDocumentTitle();
      if (searchParams.get("autoclose") === "1") {
        window.close();
        window.setTimeout(closeToOpener, 250);
        return;
      }
      closeToOpener();
    };
    window.addEventListener("afterprint", close, { once: true });
    let cancelled = false;
    void waitForPrintImages(document.querySelectorAll<HTMLImageElement>(".print-document-root img")).then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", close);
      restoreDocumentTitle();
    };
  }, [closeToOpener, printTitle, searchParams]);

  return <div className="print:hidden fixed inset-0 z-[100] grid place-items-center bg-white" aria-live="polite">Đang mở hộp thoại in…</div>;
}
