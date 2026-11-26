"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { modalCloseAction } from "@/lib/detail-return";

/**
 * Close a modal that is its own route or URL state: back to the page that
 * opened it when that is the previous history entry, else to `fallbackHref`
 * with that list's remembered filters. `modalParam` is the query key that
 * opens the modal on `fallbackHref`'s page (so in-modal paging is skipped).
 */
export function useModalClose(fallbackHref: string, options: { modalParam?: string; anyOpener?: boolean } = {}) {
  const router = useRouter();
  const { modalParam, anyOpener = false } = options;
  return useCallback(() => {
    const fallbackPath = new URL(fallbackHref, "http://luma.local").pathname;
    const action = modalCloseAction(fallbackHref, (previous) => {
      if (anyOpener) return true;
      if (previous.pathname !== fallbackPath) return false;
      return !modalParam || !previous.searchParams.has(modalParam);
    });
    if (action.kind === "back") router.back();
    else router.replace(action.href, { scroll: false });
  }, [anyOpener, fallbackHref, modalParam, router]);
}
