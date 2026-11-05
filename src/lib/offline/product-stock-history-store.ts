"use client";

import { loadProductStockHistory } from "@/lib/actions/product-stock-history";

type StockHistoryResult = Awaited<ReturnType<typeof loadProductStockHistory>>;
type StockHistoryData = Extract<StockHistoryResult, { ok: true }>["data"];

export type CachedStockHistoryPage = StockHistoryData & {
  revision: string;
  cachedAt: number;
};

const DB_NAME = "luma-pos-stock-history";
const STORE_NAME = "pages";
const inflight = new Map<string, Promise<StockHistoryResult>>();

function key(scopeId: string, productId: string, page: number) {
  return JSON.stringify([scopeId, productId, page]);
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
      if (value && Array.isArray(value.rows) && typeof value.revision === "string") {
        cached = value;
      }
    };
    transaction.oncomplete = () => { database.close(); resolve(cached); };
    transaction.onabort = transaction.onerror = () => { database.close(); resolve(null); };
  });
}

export async function writeCachedStockHistory(
  scopeId: string,
  productId: string,
  data: StockHistoryData,
  revision: string,
): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(
      { ...data, revision, cachedAt: Date.now() } satisfies CachedStockHistoryPage,
      key(scopeId, productId, data.page),
    );
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { database.close(); resolve(); };
  });
}

/** Coalesce repeated tab opens while preserving a separate cache per actor. */
export function fetchStockHistoryOnce(
  scopeId: string,
  productId: string,
  page: number,
  revision: string,
): Promise<StockHistoryResult> {
  const requestKey = JSON.stringify([scopeId, productId, page, revision]);
  const existing = inflight.get(requestKey);
  if (existing) return existing;
  const request = loadProductStockHistory(productId, page)
    .then(async (result) => {
      if (result.ok) {
        await writeCachedStockHistory(scopeId, productId, result.data, revision);
      }
      return result;
    })
    .finally(() => { inflight.delete(requestKey); });
  inflight.set(requestKey, request);
  return request;
}
