"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRefreshAppDataOnReturn } from "@/components/app-data-sync-provider";
import { openerEntry } from "@/lib/detail-return";

/**
 * After saving an edit form, go back to the page that opened it (a detail
 * modal on any list, with its filters) and refresh that page's data. Returns
 * false when there is no such page, so the caller uses its own destination.
 */
export function useReturnAfterSave() {
  const router = useRouter();
  const scheduleRefresh = useRefreshAppDataOnReturn();
  return useCallback(() => {
    const opener = openerEntry();
    if (!opener) return false;
    scheduleRefresh(opener.pathname);
    router.back();
    return true;
  }, [router, scheduleRefresh]);
}
