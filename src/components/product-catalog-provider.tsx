"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  checkProductCatalogRevision,
  syncProductCatalog,
} from "@/lib/actions/product-catalog";
import {
  readProductCatalogSnapshot,
  writeProductCatalogSnapshot,
} from "@/lib/offline/product-catalog-store";
import {
  catalogRevisionChanged,
  searchProductCatalog,
  type ProductCatalogItem,
  type ProductCatalogSearchOptions,
  type ProductCatalogSnapshot,
} from "@/lib/product-catalog";
import { createClient } from "@/lib/supabase/client";
import { createRefreshQueue } from "@/lib/sync/refresh-queue";

type ProductCatalogStatus = "loading" | "cached" | "synced" | "unavailable";

type ProductCatalogContextValue = {
  snapshot: ProductCatalogSnapshot | null;
  products: ProductCatalogItem[];
  status: ProductCatalogStatus;
  refresh: () => Promise<void>;
  search: (query: string, options?: ProductCatalogSearchOptions) => ProductCatalogItem[];
};

const ProductCatalogContext = createContext<ProductCatalogContextValue | null>(null);
const REVISION_POLL_INTERVAL_MS = 60_000;
const PRODUCT_CATALOG_CHANNEL = "luma-pos-product-catalog";

function broadcastCatalogUpdate(scopeId: string, revision: string) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(PRODUCT_CATALOG_CHANNEL);
  channel.postMessage({ scopeId, revision });
  channel.close();
}

export function ProductCatalogProvider({
  userId,
  scopeId,
  serverRevision,
  children,
}: {
  userId: string;
  scopeId: string;
  serverRevision?: string;
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<ProductCatalogSnapshot | null>(null);
  const [status, setStatus] = useState<ProductCatalogStatus>("loading");
  const syncQueueRef = useRef<ReturnType<typeof createRefreshQueue<ProductCatalogSnapshot | null>> | null>(null);
  const checkingRef = useRef<Promise<void> | null>(null);
  const revisionRef = useRef<string | null>(null);

  useEffect(() => {
    const queue = createRefreshQueue({
      load: syncProductCatalog,
      apply: async (fresh) => {
        if (!fresh || fresh.userId !== userId || fresh.scopeId !== scopeId) {
          setStatus((current) => current === "cached" ? current : "unavailable");
          return;
        }
        if (catalogRevisionChanged(fresh.revision, revisionRef.current)) return;
        setSnapshot(fresh);
        setStatus("synced");
        revisionRef.current = fresh.revision;
        await writeProductCatalogSnapshot(fresh);
        broadcastCatalogUpdate(fresh.scopeId, fresh.revision);
      },
      onError: () => {
        setStatus((current) => current === "cached" ? current : "unavailable");
      },
    });
    syncQueueRef.current = queue;
    return () => {
      queue.dispose();
      syncQueueRef.current = null;
    };
  }, [scopeId, userId]);

  const refresh = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    await syncQueueRef.current?.refresh();
  }, []);

  // Successful server mutations revalidate the layout. Do not wait for the
  // next polling tick or assume a Realtime message will always be delivered.
  useEffect(() => {
    if (catalogRevisionChanged(revisionRef.current, serverRevision)) void refresh();
  }, [refresh, serverRevision]);

  const checkForUpdates = useCallback(async () => {
    if (checkingRef.current) return checkingRef.current;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const check = checkProductCatalogRevision()
      .then(async (remoteRevision) => {
        if (catalogRevisionChanged(revisionRef.current, remoteRevision)) {
          await refresh();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        checkingRef.current = null;
      });
    checkingRef.current = check;
    return check;
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;

    readProductCatalogSnapshot(scopeId).then((cached) => {
      if (cancelled) return;
      if (cached && cached.userId === userId) {
        if (catalogRevisionChanged(cached.revision, revisionRef.current)) return;
        setSnapshot(cached);
        setStatus("cached");
        revisionRef.current = cached.revision;
        void checkForUpdates();
      } else {
        void refresh();
      }
    });

    const check = () => void checkForUpdates();
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdates();
    };
    const interval = window.setInterval(() => {
      checkWhenVisible();
    }, REVISION_POLL_INTERVAL_MS);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [checkForUpdates, refresh, scopeId, userId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`product-catalog-revision:${scopeId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "catalog_sync_state",
          filter: `store_id=eq.${scopeId.split(":", 1)[0]}`,
        },
        (payload) => {
          const remoteRevision = String(
            (payload.new as { revision?: string | number }).revision ?? "",
          );
          if (catalogRevisionChanged(revisionRef.current, remoteRevision)) {
            void refresh();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, scopeId]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let cancelled = false;
    const channel = new BroadcastChannel(PRODUCT_CATALOG_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ scopeId?: string; revision?: string }>) => {
      if (
        event.data?.scopeId !== scopeId ||
        !catalogRevisionChanged(revisionRef.current, event.data.revision)
      ) {
        return;
      }
      readProductCatalogSnapshot(scopeId).then((shared) => {
        if (
          cancelled || !shared || shared.userId !== userId ||
          !catalogRevisionChanged(revisionRef.current, shared.revision)
        ) {
          return;
        }
        setSnapshot(shared);
        setStatus("cached");
        revisionRef.current = shared.revision;
      });
    };
    return () => {
      cancelled = true;
      channel.close();
    };
  }, [scopeId, userId]);

  const search = useCallback((
    query: string,
    options?: ProductCatalogSearchOptions,
  ) => searchProductCatalog(snapshot?.products ?? [], query, options), [snapshot]);

  const value = useMemo<ProductCatalogContextValue>(() => ({
    snapshot,
    products: snapshot?.products ?? [],
    status,
    refresh,
    search,
  }), [refresh, search, snapshot, status]);

  return (
    <ProductCatalogContext.Provider value={value}>
      {children}
    </ProductCatalogContext.Provider>
  );
}

export function useProductCatalog(): ProductCatalogContextValue {
  const context = useContext(ProductCatalogContext);
  if (!context) {
    throw new Error("useProductCatalog must be used inside ProductCatalogProvider");
  }
  return context;
}
