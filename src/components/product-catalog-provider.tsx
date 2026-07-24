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
import { syncProductCatalog } from "@/lib/actions/product-catalog";
import {
  readProductCatalogSnapshot,
  writeProductCatalogSnapshot,
} from "@/lib/offline/product-catalog-store";
import {
  searchProductCatalog,
  type ProductCatalogItem,
  type ProductCatalogSearchOptions,
  type ProductCatalogSnapshot,
} from "@/lib/product-catalog";

type ProductCatalogStatus = "loading" | "cached" | "synced" | "unavailable";

type ProductCatalogContextValue = {
  snapshot: ProductCatalogSnapshot | null;
  products: ProductCatalogItem[];
  status: ProductCatalogStatus;
  refresh: () => Promise<void>;
  search: (query: string, options?: ProductCatalogSearchOptions) => ProductCatalogItem[];
};

const ProductCatalogContext = createContext<ProductCatalogContextValue | null>(null);
const FOCUS_REFRESH_INTERVAL_MS = 60_000;
const PRODUCT_CATALOG_CHANNEL = "luma-pos-product-catalog";

function broadcastCatalogUpdate(scopeId: string, savedAt: number) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(PRODUCT_CATALOG_CHANNEL);
  channel.postMessage({ scopeId, savedAt });
  channel.close();
}

export function ProductCatalogProvider({
  userId,
  scopeId,
  children,
}: {
  userId: string;
  scopeId: string;
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<ProductCatalogSnapshot | null>(null);
  const [status, setStatus] = useState<ProductCatalogStatus>("loading");
  const syncingRef = useRef<Promise<void> | null>(null);
  const lastRefreshRef = useRef(0);

  const refresh = useCallback(async () => {
    if (syncingRef.current) return syncingRef.current;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const sync = syncProductCatalog()
      .then(async (fresh) => {
        if (!fresh || fresh.userId !== userId || fresh.scopeId !== scopeId) {
          setStatus((current) => current === "cached" ? current : "unavailable");
          return;
        }
        setSnapshot(fresh);
        setStatus("synced");
        lastRefreshRef.current = Date.now();
        await writeProductCatalogSnapshot(fresh);
        broadcastCatalogUpdate(fresh.scopeId, fresh.savedAt);
      })
      .catch(() => {
        setStatus((current) => current === "cached" ? current : "unavailable");
      })
      .finally(() => {
        syncingRef.current = null;
      });

    syncingRef.current = sync;
    return sync;
  }, [scopeId, userId]);

  useEffect(() => {
    let cancelled = false;

    readProductCatalogSnapshot(scopeId).then((cached) => {
      if (cancelled) return;
      if (cached) {
        setSnapshot(cached);
        setStatus("cached");
        lastRefreshRef.current = cached.savedAt;
      }
      void refresh();
    });

    const refreshIfStale = () => {
      if (Date.now() - lastRefreshRef.current >= FOCUS_REFRESH_INTERVAL_MS) {
        void refresh();
      }
    };
    window.addEventListener("online", refreshIfStale);
    window.addEventListener("focus", refreshIfStale);

    return () => {
      cancelled = true;
      window.removeEventListener("online", refreshIfStale);
      window.removeEventListener("focus", refreshIfStale);
    };
  }, [refresh, scopeId]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(PRODUCT_CATALOG_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ scopeId?: string; savedAt?: number }>) => {
      if (
        event.data?.scopeId !== scopeId ||
        Number(event.data.savedAt) <= lastRefreshRef.current
      ) {
        return;
      }
      readProductCatalogSnapshot(scopeId).then((shared) => {
        if (!shared || shared.savedAt <= lastRefreshRef.current) return;
        setSnapshot(shared);
        setStatus("cached");
        lastRefreshRef.current = shared.savedAt;
      });
    };
    return () => channel.close();
  }, [scopeId]);

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
