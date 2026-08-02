"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function AutoPrint({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const close = () => {
      if (searchParams.get("autoclose") === "1") {
        window.close();
        window.setTimeout(() => router.replace(closeHref, { scroll: false }), 250);
        return;
      }
      router.replace(closeHref, { scroll: false });
    };
    window.addEventListener("afterprint", close, { once: true });
    const id = window.setTimeout(() => window.print(), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("afterprint", close);
    };
  }, [closeHref, router, searchParams]);

  return <div className="print:hidden fixed inset-0 z-[100] grid place-items-center bg-white" aria-live="polite">Đang mở hộp thoại in…</div>;
}
