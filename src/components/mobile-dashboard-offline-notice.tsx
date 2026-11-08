"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * This notice refers only to the server-rendered dashboard still on screen.
 * It does not claim that a fresh server page can cold-launch offline.
 * No polling, API calls, or additional catalog subscriptions.
 */
export function MobileDashboardOfflineNotice() {
  const t = useTranslations();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const checkConnection = () => setOffline(!navigator.onLine);
    checkConnection();
    window.addEventListener("offline", checkConnection);
    window.addEventListener("online", checkConnection);
    return () => {
      window.removeEventListener("offline", checkConnection);
      window.removeEventListener("online", checkConnection);
    };
  }, []);

  if (!offline) return null;
  return (
    <div role="status" aria-live="polite"
      className="flex min-h-11 items-center gap-2 rounded-xl bg-in-soft px-3 py-2.5 text-sm font-semibold text-in lg:hidden">
      <Info className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{t("mobile.dashboard.offlineNotice")}</span>
    </div>
  );
}
