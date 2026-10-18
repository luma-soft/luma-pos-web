"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { shouldRefreshDeferredAppPath } from "@/lib/sync/deferred-app-route-refresh";

const AppDataRevisionContext = createContext<string | null>(null);
const RefreshOnReturnContext = createContext<((path: string) => void) | null>(null);

/** A new server render invalidates client-owned read models, not edit drafts. */
export function AppDataSyncProvider({
  revision,
  children,
}: {
  revision: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const hasProductModal = searchParams.has("productModal");
  const routeKey = query ? `${pathname}?${query}` : pathname;
  const previousRouteKeyRef = useRef(routeKey);
  const pendingRefreshPathRef = useRef<string | null>(null);
  const [localRevision, setLocalRevision] = useState(0);
  const currentRevision = localRevision ? `${revision}:${localRevision}` : revision;

  const scheduleRefreshOnReturn = useCallback((path: string) => {
    pendingRefreshPathRef.current = path;
  }, []);

  useEffect(() => {
    const routeChanged = previousRouteKeyRef.current !== routeKey;
    previousRouteKeyRef.current = routeKey;
    if (!shouldRefreshDeferredAppPath({
      routeChanged,
      pendingPath: pendingRefreshPathRef.current,
      currentPath: pathname,
      modalOpen: hasProductModal,
    })) return;

    pendingRefreshPathRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      startTransition(() => {
        setLocalRevision((current) => current + 1);
        router.refresh();
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasProductModal, pathname, revision, routeKey, router]);

  return (
    <AppDataRevisionContext.Provider value={currentRevision}>
      <RefreshOnReturnContext.Provider value={scheduleRefreshOnReturn}>
        {children}
      </RefreshOnReturnContext.Provider>
    </AppDataRevisionContext.Provider>
  );
}

export function useAppDataRevision() {
  return useContext(AppDataRevisionContext);
}

export function useRefreshAppDataOnReturn() {
  const scheduleRefresh = useContext(RefreshOnReturnContext);
  if (!scheduleRefresh) throw new Error("useRefreshAppDataOnReturn must be used inside AppDataSyncProvider");
  return scheduleRefresh;
}
