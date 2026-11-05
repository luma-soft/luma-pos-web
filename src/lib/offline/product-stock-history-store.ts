"use client";

import {
  checkProductStockHistoryVersion,
  loadProductStockHistory,
} from "@/lib/actions/product-stock-history";

type StockHistoryResult = Awaited<ReturnType<typeof loadProductStockHistory>>;
type StockHistoryData = Extract<StockHistoryResult, { ok: true }>["data"];

export type CachedStockHistoryPage = StockHistoryData & {
  cachedAt: number;
};

const DB_NAME = "luma-pos-stock-history";
const STORE_NAME = "pages";
const inflight = new Map<string, Promise<StockHistoryResult>>();
const versionChecks = new Map<string, Promise<string>>();
// Signing out invalidates pending writes, including those already in-flight.
let cacheEpoch = 0;

function key(scopeId: string, productId: string, page: number) {
  return JSON.stringify([scopeId, productId, page]);
}

function productRange(scopeId: string, productId: string) {
  const prefix = JSON.stringify([scopeId, productId]).slice(0, -1) + ",";
  return IDBKeyRange.bound(prefix, prefix + "\uffff");
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
}

export async function readCachedStockHistory(
  scopeId: string,
  productId: string,
  page: number,
): Promise<CachedStockHistoryPage | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key(scopeId, productId, page));
    let cached: CachedStockHistoryPage | null = null;
    request.onsuccess = () => {
      const value = request.result as CachedStockHistoryPage | undefined;
      if (
        value && value.scopeId === scopeId && Array.isArray(value.rows)
        && typeof value.version === "string"
      ) cached = value;
    };
    transaction.oncomplete = () => { database.close(); resolve(cached); };
    transaction.onabort = transaction.onerror = () => { database.close(); resolve(null); };
  });
}

async function writeCachedStockHistory(
  scopeId: string,
  productId: string,
  data: StockHistoryData,
): Promise<void> {
  if (data.scopeId !== scopeId) return;
  const epoch = cacheEpoch;
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    if (epoch !== cacheEpoch) { database.close(); resolve(); return; }
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    // A stock movement invalidates all previous pages for THIS PRODUCT ONLY.
    // Commit the invalidation and new page atomically; never put all movement
    // history into the shared catalog or wipe unrelated product history.
    const request = store.openCursor(productRange(scopeId, productId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const previous = cursor.value as CachedStockHistoryPage | undefined;
        if (previous?.version !== data.version) cursor.delete();
        cursor.continue();
      } else {
        if (epoch !== cacheEpoch) { transaction.abort(); return; }
        store.put({ ...data, cachedAt: Date.now() } satisfies CachedStockHistoryPage,
          key(scopeId, productId, data.page));
      }
    };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { database.close(); resolve(); };
  });
}

/**
 * A cheap per-product check avoids re-downloading all cached pages when an
 * unrelated product increments the global catalog revision.
 */
export function checkStockHistoryVersionOnce(
  scopeId: string,
  productId: string,
): Promise<string> {
  const requestKey = JSON.stringify([scopeId, productId]);
  const pending = versionChecks.get(requestKey);
  if (pending) return pending;
  const promise = checkProductStockHistoryVersion(productId)
    .then((result) => {
      if (!result.ok || result.data.scopeId !== scopeId) throw new Error("STOCK_CARD_SCOPE_OR_ACCESS");
      return result.data.version;
    }).finally(() => { versionChecks.delete(requestKey); });
  versionChecks.set(requestKey, promise);
  return promise;
}

/** Coalesce repeated tab opens while preserving one cache per actor/scope. */
export function fetchStockHistoryOnce(
  scopeId: string,
  productId: string,
  page: number,
): Promise<StockHistoryResult> {
  const requestKey = key(scopeId, productId, page);
  const existing = inflight.get(requestKey);
  if (existing) return existing;
  const epoch = cacheEpoch;
  const request = loadProductStockHistory(productId, page)
    .then(async (result): Promise<StockHistoryResult> => {
      if (!result.ok) return result;
      if (result.data.scopeId !== scopeId || epoch !== cacheEpoch) {
        return { ok: false, error: "errors.unauthorized" };
      }
      await writeCachedStockHistory(scopeId, productId, result.data);
      return result;
    })
    .finally(() => { inflight.delete(requestKey); });
  inflight.set(requestKey, request);
  return request;
}

/** Stock history is disposable; never leave a former actor's cost data on disk. */
export async function clearCachedStockHistoryForUser(userId: string): Promise<void> {
  cacheEpoch += 1;
  inflight.clear();
  versionChecks.clear();
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      try {
        const parsed = JSON.parse(String(cursor.key)) as unknown;
        if (Array.isArray(parsed) && typeof parsed[0] === "string") {
          const parts = parsed[0].split(":");
          if (parts[1] === userId) cursor.delete();
        }
      } catch {
        // Unknown legacy key shapes cannot be assigned to this user safely.
      }
      cursor.continue();
    };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { database.close(); resolve(); };
  });
}
