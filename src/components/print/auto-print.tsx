"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { waitForPrintImages } from "@/lib/print/wait-for-images";

export function AutoPrint({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("embedded") === "1") {
      let cancelled = false;
      void waitForPrintImages(document.querySelectorAll<HTMLImageElement>(".print-document-root img")).then(() => {
        if (cancelled) return;
        window.parent.postMessage({ type: "luma-print-ready" }, window.location.origin);
      });
      return () => { cancelled = true; };
    }
    const close = () => {
      if (searchParams.get("autoclose") === "1") {
        window.close();
        window.setTimeout(() => router.replace(closeHref, { scroll: false }), 250);
        return;
      }
      router.replace(closeHref, { scroll: false });
    };
    window.addEventListener("afterprint", close, { once: true });
    let cancelled = false;
    void waitForPrintImages(document.querySelectorAll<HTMLImageElement>(".print-document-root img")).then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", close);
    };
  }, [closeHref, router, searchParams]);

  return <div className="print:hidden fixed inset-0 z-[100] grid place-items-center bg-white" aria-live="polite">Đang mở hộp thoại in…</div>;
}
