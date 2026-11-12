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
  productCatalogWriteChangesForSync,
  readProductCatalogSnapshot,
  writeProductCatalogSnapshot,
} from "@/lib/offline/product-catalog-store";
import {
  catalogRevisionChanged,
  mergeProductCatalogDelta,
  prepareProductCatalogSearchIndex,
  searchProductCatalog,
  type ProductCatalogItem,
  type ProductCatalogSearchOptions,
  type ProductCatalogSnapshot,
} from "@/lib/product-catalog";
import { getInventorySearchableProducts } from "@/lib/product-catalog-explorer";
import {
  DEFAULT_PRODUCT_SORT,
  parseProductSort,
  sortProductsBySort,
  writeProductSortPreferenceCookie,
  type ProductSort,
} from "@/lib/product-sort-policy";
import { createRefreshQueue } from "@/lib/sync/refresh-queue";

type ProductCatalogStatus = "loading" | "cached" | "synced" | "unavailable";
type ProductCatalogSyncValue = Awaited<ReturnType<typeof syncProductCatalog>>;

type ProductCatalogContextValue = {
  snapshot: ProductCatalogSnapshot | null;
  products: ProductCatalogItem[];
  status: ProductCatalogStatus;
  defaultSort: ProductSort;
  setDefaultSort: (sort: ProductSort) => void;
  refresh: () => Promise<void>;
  search: (query: string, options?: ProductCatalogSearchOptions) => ProductCatalogItem[];
};

const ProductCatalogContext = createContext<ProductCatalogContextValue | null>(null);
const REVISION_POLL_INTERVAL_MS = 60_000;
const PRODUCT_CATALOG_CHANNEL = "luma-pos-product-catalog";
const PRODUCT_SORT_CHANNEL = "luma-product-sort-preference";
const MAX_IN_MEMORY_CATALOGS = 3;
const inMemorySnapshots = new Map<string, ProductCatalogSnapshot>();
const inMemorySortPreferences = new Map<string, ProductSort>();

function readInMemorySnapshot(scopeId: string, userId: string): ProductCatalogSnapshot | null {
  if (typeof window === "undefined") return null;
  const snapshot = inMemorySnapshots.get(scopeId);
  if (!snapshot || snapshot.userId !== userId || snapshot.scopeId !== scopeId) return null;
  inMemorySnapshots.delete(scopeId);
  inMemorySnapshots.set(scopeId, snapshot);
  return snapshot;
}

function cacheInMemorySnapshot(snapshot: ProductCatalogSnapshot) {
  if (typeof window === "undefined") return;
  inMemorySnapshots.delete(snapshot.scopeId);
  inMemorySnapshots.set(snapshot.scopeId, snapshot);
  while (inMemorySnapshots.size > MAX_IN_MEMORY_CATALOGS) {
    const oldestScope = inMemorySnapshots.keys().next().value;
    if (!oldestScope) break;
    inMemorySnapshots.delete(oldestScope);
  }
}

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
  initialDefaultSort = DEFAULT_PRODUCT_SORT,
  children,
}: {
  userId: string;
  scopeId: string;
  serverRevision?: string;
  initialDefaultSort?: ProductSort;
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<ProductCatalogSnapshot | null>(() => readInMemorySnapshot(scopeId, userId));
  const [status, setStatus] = useState<ProductCatalogStatus>(() => snapshot ? "cached" : "loading");
  const [defaultSort, setDefaultSortState] = useState<ProductSort>(
    () => (typeof window !== "undefined" ? inMemorySortPreferences.get(scopeId) : undefined) ?? initialDefaultSort,
  );
  const syncQueueRef = useRef<ReturnType<typeof createRefreshQueue<ProductCatalogSyncValue>> | null>(null);
  const checkingRef = useRef<Promise<void> | null>(null);
  const snapshotRef = useRef<ProductCatalogSnapshot | null>(snapshot);
  const revisionRef = useRef<string | null>(snapshot?.revision ?? null);
  const syncStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const queue = createRefreshQueue({
      load: () => {
        syncStartedAtRef.current = performance.now();
        return syncProductCatalog(revisionRef.current);
      },
      apply: async (result) => {
        const applyStartedAt = performance.now();
        const revisionBefore = revisionRef.current;
        let fresh: ProductCatalogSnapshot | null = result?.mode === "full"
          ? result.snapshot
          : null;
        // A failed delta must never leak its changed-ID list into a full recovery write.
        let appliedIncrementalDelta = false;

        if (result?.mode === "unchanged") {
          const current = snapshotRef.current;
          if (
            current?.userId === result.userId
            && current.scopeId === result.scopeId
            && current.revision === result.revision
          ) {
            setStatus("synced");
            return;
          }
        } else if (result?.mode === "delta") {
          const current = snapshotRef.current;
          fresh = current ? mergeProductCatalogDelta(current, result.delta) : null;
          appliedIncrementalDelta = fresh !== null;
        }

        // A stale/mismatched local snapshot or unavailable delta journal must
        // never be persisted as a partial catalog. Recover with the full path.
        if (!fresh && result) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[product-catalog] full recovery", { reason: "invalid-or-stale-delta" });
          }
          const recovered = await syncProductCatalog();
          fresh = recovered?.mode === "full" ? recovered.snapshot : null;
          appliedIncrementalDelta = false;
        }
        if (!fresh || fresh.userId !== userId || fresh.scopeId !== scopeId) {
          setStatus((current) => current === "cached" ? current : "unavailable");
          return;
        }
        if (catalogRevisionChanged(fresh.revision, revisionRef.current)) return;
        const delta = appliedIncrementalDelta && result?.mode === "delta" ? result.delta : null;
        const changedProductIDs = new Set(delta?.upserts.map((product) => product.id) ?? []);
        const deletedProductIDs = delta?.deletedIds ?? [];
        if (delta?.metadata) {
          const categoryIDs = new Set(delta.metadata.categories?.upserts.map((item) => item.id) ?? []);
          delta.metadata.categories?.deletedIds.forEach((id) => categoryIDs.add(id));
          const brandIDs = new Set(delta.metadata.brands?.upserts.map((item) => item.id) ?? []);
          delta.metadata.brands?.deletedIds.forEach((id) => brandIDs.add(id));
          const supplierIDs = new Set(delta.metadata.suppliers?.upserts.map((item) => item.id) ?? []);
          delta.metadata.suppliers?.deletedIds.forEach((id) => supplierIDs.add(id));
          for (const product of fresh.products) {
            if (
              (product.categoryId && categoryIDs.has(product.categoryId)) ||
              (product.brandId && brandIDs.has(product.brandId)) ||
              (product.supplierId && supplierIDs.has(product.supplierId))
            ) changedProductIDs.add(product.id);
          }
          if (delta.metadata.warehouses) {
            fresh.products.forEach((product) => changedProductIDs.add(product.id));
          }
        }
        const persistStartedAt = performance.now();
        let committed = false;
        try {
          const writeChanges = productCatalogWriteChangesForSync(
            result?.mode === "delta" ? result.delta : null,
            appliedIncrementalDelta,
            [...changedProductIDs],
          );
          committed = await writeProductCatalogSnapshot(
            fresh,
            writeChanges,
          );
        } catch {
          // IndexedDB can be disabled or temporarily fail. Keep online browsing
          // functional without announcing a revision that was never persisted.
        }
        if (!committed) {
          const shared = await readProductCatalogSnapshot(scopeId);
          const usable = shared?.userId === userId && shared.scopeId === scopeId
            && catalogRevisionChanged(fresh.revision, shared.revision)
            ? shared : fresh;
          if (!catalogRevisionChanged(usable.revision, revisionRef.current)) {
            cacheInMemorySnapshot(usable);
            snapshotRef.current = usable;
            setSnapshot(usable);
            setStatus("synced");
            revisionRef.current = usable.revision;
          }
          return;
        }
        if (catalogRevisionChanged(fresh.revision, revisionRef.current)) return;
        snapshotRef.current = fresh;
        cacheInMemorySnapshot(fresh);
        setSnapshot(fresh);
        setStatus("synced");
        revisionRef.current = fresh.revision;
        if (process.env.NODE_ENV !== "production") {
          const encoded = JSON.stringify(result);
          console.debug("[product-catalog] sync", {
            mode: appliedIncrementalDelta ? "delta" : result?.mode === "delta" ? "full-recovery" : result?.mode ?? "unavailable",
            revisionBefore,
            revisionAfter: fresh.revision,
            changedEntities: delta ? changedProductIDs.size + deletedProductIDs.length : fresh.products.length,
            responseBytes: encoded ? new TextEncoder().encode(encoded).byteLength : 0,
            syncDurationMs: syncStartedAtRef.current == null ? null : Math.round(applyStartedAt - syncStartedAtRef.current),
            applyDurationMs: Math.round(performance.now() - applyStartedAt),
            indexedDBDurationMs: Math.round(performance.now() - persistStartedAt),
          });
        }
        syncStartedAtRef.current = null;
        broadcastCatalogUpdate(fresh.scopeId, fresh.revision);
        if (result?.mode === "delta" && result.delta.hasMore) {
          // Continue bounded pages from the just-committed revision. Each
          // page becomes locally usable before the next request starts.
          void queue.refresh();
        }
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

  const refresh = useCallback(async (expectedRevision?: string | null) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const queue = syncQueueRef.current;
    if (!queue) return;
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) {
      await queue.refresh();
      return;
    }

    await locks.request(`luma-product-catalog:${scopeId}`, async () => {
      // Recheck after acquiring the cross-tab lock. A tab may have completed
      // the full cold-start sync while this tab was waiting; reuse its snapshot
      // and ask the server for unchanged/delta instead of downloading it again.
      const shared = await readProductCatalogSnapshot(scopeId);
      if (shared?.userId === userId && shared.scopeId === scopeId) {
        const current = snapshotRef.current;
        const sharedIsNotOlder = !current || current.scopeId !== scopeId ||
          !catalogRevisionChanged(shared.revision, current.revision);
        if (sharedIsNotOlder) {
          cacheInMemorySnapshot(shared);
          snapshotRef.current = shared;
          setSnapshot(shared);
          setStatus("cached");
          revisionRef.current = shared.revision;
          if (
            expectedRevision != null &&
            !catalogRevisionChanged(shared.revision, expectedRevision)
          ) return;
        }
      }
      await queue.refresh();
    });
  }, [scopeId, userId]);

  const setDefaultSort = useCallback((sort: ProductSort) => {
    const next = parseProductSort(sort);
    inMemorySortPreferences.set(scopeId, next);
    setDefaultSortState(next);
    writeProductSortPreferenceCookie(scopeId.split(":", 1)[0] ?? "", next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("luma:product-sort-preference", { detail: { scopeId, sort: next } }));
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(PRODUCT_SORT_CHANNEL);
        channel.postMessage({ scopeId, sort: next });
        channel.close();
      }
    }
  }, [scopeId]);

  useEffect(() => {
    inMemorySortPreferences.set(scopeId, defaultSort);
  }, [defaultSort, scopeId]);

  useEffect(() => {
    const applyPreference = (value: unknown) => {
      const event = value as {
        detail?: { scopeId?: string; sort?: unknown };
        data?: { scopeId?: string; sort?: unknown };
      };
      const update = event.detail ?? event.data;
      if (update?.scopeId !== scopeId || typeof update.sort !== "string") return;
      const next = parseProductSort(update.sort);
      inMemorySortPreferences.set(scopeId, next);
      setDefaultSortState(next);
    };
    window.addEventListener("luma:product-sort-preference", applyPreference);
    if (typeof BroadcastChannel === "undefined") {
      return () => window.removeEventListener("luma:product-sort-preference", applyPreference);
    }
    const channel = new BroadcastChannel(PRODUCT_SORT_CHANNEL);
    channel.addEventListener("message", applyPreference);
    return () => {
      window.removeEventListener("luma:product-sort-preference", applyPreference);
      channel.close();
    };
  }, [scopeId]);

  // Successful server mutations revalidate the layout. Do not wait for the
  // next polling tick or assume a Realtime message will always be delivered.
  useEffect(() => {
    if (catalogRevisionChanged(revisionRef.current, serverRevision)) void refresh(serverRevision);
  }, [refresh, serverRevision]);

  const checkForUpdates = useCallback(async () => {
    if (checkingRef.current) {
      if (process.env.NODE_ENV !== "production") {
        console.debug("[product-catalog] duplicate revision check coalesced");
      }
      return checkingRef.current;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const check = checkProductCatalogRevision()
      .then(async (remoteRevision) => {
        if (catalogRevisionChanged(revisionRef.current, remoteRevision)) {
          await refresh(remoteRevision);
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

    const hydrationStartedAt = performance.now();
    readProductCatalogSnapshot(scopeId).then((cached) => {
      if (cancelled) return;
      if (process.env.NODE_ENV !== "production") {
        console.debug("[product-catalog] hydration", {
          durationMs: Math.round(performance.now() - hydrationStartedAt),
          products: cached?.products.length ?? 0,
          hasSnapshot: Boolean(cached),
        });
      }
      if (cached && cached.userId === userId && cached.scopeId === scopeId) {
        const current = snapshotRef.current;
        if (!current || catalogRevisionChanged(current.revision, cached.revision)) {
          cacheInMemorySnapshot(cached);
          snapshotRef.current = cached;
          setSnapshot(cached);
          setStatus("cached");
          revisionRef.current = cached.revision;
        }
        void checkForUpdates();
      } else {
        if (snapshotRef.current?.userId === userId && snapshotRef.current.scopeId === scopeId) {
          void checkForUpdates();
        } else {
          void refresh();
        }
      }
    });

    const check = () => void checkForUpdates();
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdates();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
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
          cancelled || !shared || shared.userId !== userId || shared.scopeId !== scopeId ||
          !catalogRevisionChanged(revisionRef.current, shared.revision)
        ) {
          return;
        }
        cacheInMemorySnapshot(shared);
        snapshotRef.current = shared;
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

  // Prepare both canonical and Inventory-only indexes in idle slices, outside
  // render and keystroke handlers. Non-variant catalogs share one index.
  useEffect(() => {
    if (!snapshot) return;
    const inventoryProducts = getInventorySearchableProducts(snapshot.products);
    const stopCanonical = prepareProductCatalogSearchIndex(snapshot.products);
    const stopInventory = inventoryProducts === snapshot.products
      ? () => undefined
      : prepareProductCatalogSearchIndex(inventoryProducts);
    return () => {
      stopCanonical();
      stopInventory();
    };
  }, [snapshot]);

  const search = useCallback((
    query: string,
    options?: ProductCatalogSearchOptions,
  ) => {
    const startedAt = performance.now();
    const rows = searchProductCatalog(snapshot?.products ?? [], query, { ...options, sort: options?.sort ?? defaultSort });
    if (process.env.NODE_ENV !== "production") {
      console.debug("[product-catalog] search", {
        latencyMs: Math.round(performance.now() - startedAt),
        candidateCount: snapshot?.products.length ?? 0,
        resultCount: rows.length,
      });
    }
    return rows;
  }, [defaultSort, snapshot]);

  const products = useMemo(
    () => snapshot ? sortProductsBySort(snapshot.products, defaultSort) : [],
    [defaultSort, snapshot],
  );

  const value = useMemo<ProductCatalogContextValue>(() => ({
    snapshot,
    products,
    status,
    defaultSort,
    setDefaultSort,
    refresh,
    search,
  }), [defaultSort, products, refresh, search, setDefaultSort, snapshot, status]);

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
